/*
  Copyright (C) 2018-present evan GmbH. 
  
  This program is free software: you can redistribute it and/or modify it
  under the terms of the GNU Affero General Public License, version 3, 
  as published by the Free Software Foundation. 
  
  This program is distributed in the hope that it will be useful, 
  but WITHOUT ANY WARRANTY; without even the implied warranty of 
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
  See the GNU Affero General Public License for more details. 
  
  You should have received a copy of the GNU Affero General Public License along with this program.
  If not, see http://www.gnu.org/licenses/ or write to the
  
  Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA, 02110-1301 USA,
  
  or download the license from the following URL: https://evan.network/license/ 
  
  You can be released from the requirements of the GNU Affero General Public License
  by purchasing a commercial license.
  Buying such a license is mandatory as soon as you use this software or parts of it
  on other blockchains than evan.network. 
  
  For more information, please contact evan GmbH at this address: https://evan.network/license/ 
*/

'use strict'
const request = require('request')
const { Initializer, api } = require('actionhero')
const { ContractState, DataContract, Definition, Sharing } = require('blockchain-core')

const config = api.config.smartAgentTasks
const weatherEn = /.*weather (?:in|at|near) ([\w -]+)/i
const weatherDe = /.*wetter (?:in|bei|nahe|um) ([\w -]+)/i


async function getWeatherComment(comment) {
  return new Promise((resolve, reject) => {
    let lang
    let units
    let location
    if (weatherEn.test(comment)) {
      location = comment.replace(weatherEn, '$1')
      lang = 'en'
      units = 'imperial'
    } else if (weatherDe.test(comment)) {
      location = comment.replace(weatherDe, '$1')
      lang = 'de'
      units = 'metric'
    } else if (comment.indexOf('weather') != -1) {
      location = 'Eisenach'
      lang = 'en'
      units = 'imperial'
    } else if (comment.indexOf('wetter') != -1) {
      location = 'Eisenach'
      lang = 'de'
      units = 'metric'
    }
    if (lang) {
      // request weather data
      const requestUri = `http://api.openweathermap.org/data/2.5/weather?q=${location}&appid=1a25b5c4007f12dd2e489267db72aaf1&lang=${lang}&units=${units}`
      request(requestUri, (error, _, body) => {
        if (error) {
          reject(error)
        } else {
          const weather = JSON.parse(body)
          if(!weather.name) {
            resolve(`${lang === 'de' ? 'Wetter konnte nicht ermittelt werden ' : 'weather could not be retrieved '}`)
          } else {
            resolve(`${lang === 'de' ? 'Wetter in ' : 'weather in '}${weather.name}: ${weather.main.temp}°${lang === 'de' ? 'C' : 'F'}, ${weather.weather[0].description}`)
          }
        }
      });
    } else {
      resolve(null);
    }
  });
}


module.exports = class SmartAgentTasks extends Initializer {
  constructor () {
    super()
    this.name = 'smartAgentTasks'
    this.loadPriority = 2400
    this.startPriority = 2400
    this.stopPriority = 2400
  }

  async initialize () {
    if (config.disabled) {
      return
    }
    class SmartAgentTasks extends api.smartAgents.SmartAgent {
      async initialize() {
        await super.initialize()
        this.definition = new Definition({
          executor: api.bcc.executor,
          contractLoader: api.bcc.contractLoader,
          dfs: api.bcc.ipfs,
          nameResolver: api.bcc.nameResolver,
          cryptoProvider: api.bcc.cryptoProvider,
          keyProvider: this.keyProvider,
        })
        this.sharing = new Sharing({
          contractLoader: api.bcc.contractLoader,
          cryptoProvider: api.bcc.cryptoProvider,
          definition: this.definition,
          executor: api.bcc.executor,
          dfs: api.bcc.ipfs,
          keyProvider: this.keyProvider,
          nameResolver: api.bcc.nameResolver,
          defaultCryptoAlgo: api.bcc.defaultCryptoAlgo,
        })
        this.definition.sharing = this.sharing;
        this.dataContract = new DataContract({
          cryptoProvider: api.bcc.cryptoProvider,
          dfs: api.bcc.ipfs,
          executor: api.bcc.executor,
          loader: api.bcc.contractLoader,
          log: api.log,
          nameResolver: api.bcc.nameResolver,
          sharing: this.sharing,
          web3: api.eth.web3,
          definition: this.definition,
        })
      }
      async startTaskListener() {
        try {
          const taskContractType = api.eth.web3.utils.sha3('TaskDataContract')
          let processingQueue = Promise.resolve()
          // get block from last uptime
          const lastBlockOuter  = await api.redis.clients.client.get('contractus:smartAgentTasks:lastBlock') || (await api.eth.web3.eth.getBlockNumber())
          api.log(`last lastBlockOuter: ${lastBlockOuter}`)
          await api.bcc.eventHub.subscribe('EventHub', null, 'ContractEvent',
            async (event) => {
              const { eventType, contractType, member } = event.returnValues;
              return member === this.config.ethAccount &&   // invited user is smart agent
                contractType === taskContractType &&        // task data contract
                eventType === '0'                           // invite
              ;
            },
            (event) => {
              const handleEvent = async () => {
                // we got an invitation, wait for a contract release
                const blockNumber = event.blockNumber;
                const { contractAddress } = event.returnValues;
                // mark outer block as handled
                await api.redis.clients.client.set('contractus:smartAgentTasks:lastBlock', blockNumber)
                // store block and contract to continue later on
                await api.redis.clients.client.zadd('contractus:smartAgentTasks:lastBlocks', blockNumber, contractAddress)
                // load all remaining contracts and start listeners
                this.subscribeForContractRelease(contractAddress, blockNumber)
              }
              processingQueue = processingQueue
                .then(handleEvent)
                .catch((ex) => {
                  // log errors as warnings because events handled here MAY origin from older config states
                  api.log(`error occurred while handling event from block ${event.blockNumber}; ${ex.message || ex}${ex.stack ? ex.stack : ''}`, 'warning')
                })
              return processingQueue
            },
            lastBlockOuter,
          )
          // load all remaining contracts and start listeners
          // fetch remaining contract listener and start their own once listener
          const remaining = (await api.redis.clients.client.zrange('contractus:smartAgentTasks:lastBlocks', 0, -1, 'WITHSCORES'))
          api.log(`remaining blocks and contracts: ${JSON.stringify(remaining, null, 2)}`)
          while (remaining.length >= 2) {
            const [contractAddress, block] = remaining.splice(0, 2);
            this.subscribeForContractRelease(contractAddress, block)
          }
        } catch (ex) {
          api.log(`could not bind taskListener; ${ ex.message || ex }`, 'warning')
        }
      }
      async subscribeForContractRelease(contractAddress, block) {
        api.bcc.eventHub.once('BaseContractInterface', contractAddress, 'StateshiftEvent',
          (event) => {
            const { state } = event.returnValues;
            return state && parseInt(state, 10) === ContractState.Active;
          },
          async () => {
            // mark block/contract as done
            await api.redis.clients.client.zrem('contractus:smartAgentTasks:lastBlocks', contractAddress)
            const contract = api.bcc.contractLoader.loadContract('DataContractInterface', contractAddress)
            const isConsumer = await api.bcc.executor.executeContractCall(contract, 'isConsumer', this.config.ethAccount)
            if (isConsumer) {
              const entries = await this.dataContract.getListEntries(contract, 'todos', this.config.ethAccount)
              await this.dataContract.changeConsumerState(contract, this.config.ethAccount, this.config.ethAccount, 4);
              if (entries && entries.length) {
                for (let entry of entries) {
                  let answer = {
                    id: entry.id,
                    comment: null,
                    solveTime: (new Date()).getTime(),
                    solver: this.config.ethAccount,
                    solverAlias: 'Smart Agent',
                  }
                  answer.comment = await getWeatherComment(entry.alias.toLowerCase())
                  if (answer.comment) {
                    await this.dataContract.addListEntries(contract, 'todologs', [answer], this.config.ethAccount)
                  }
                }
              }
            }
          }, block
        );
      }
    }

    const smartAgentTasks = new SmartAgentTasks(config)
    await smartAgentTasks.initialize()
    await smartAgentTasks.startTaskListener()
  }

  async start () {}
  async stop () {}
}
