exports['default'] = {
  // makes your used evan.network accounts and private keys known to the blockchain-core
  // so the library can sign and encrypt with it.
  ethAccounts: {
    '0xa60F5EAfBb782793d7589bc5F55BfA3a599B182d' :
      '4fb3cc3b3150e3a8c1a40ae677cecc7bbfaf2dbec396ac551af5ec75f59a4e65',
  },

  // the different needed encryption keys associated with each account or account pair
  // also collected and merged in the blockchain-core library
  encryptionKeys: {

    // comm key
    //'0xa60F5EAfBb782793d7589bc5F55BfA3a599B182d,0xa60F5EAfBb782793d7589bc5F55BfA3a599B182d':
    '0x56ec2af1230ae95fe4d18d238a43d75e17026f260ad2e3a91a86de123ba72a03':
      '346c22768f84f3050f5c94cec98349b3c5cbfa0b7315304e13647a4918ffffab',

    // data key
    //'0xa60F5EAfBb782793d7589bc5F55BfA3a599B182d':
    '0x064afbfe509dd056ff0011bb2a6d019b9fb8c4a9079b1276cd791c688e333b7a':
      '346c22768f84f3050f5c94cec98349b3c5cbfa0b7315304e13647a4918ffffab',
  },

  smartAgentTasks: (api) => {
    return {
      disabled:  process.env.SMART_AGENT_TASKS_DISABLED ?  JSON.parse(process.env.SMART_AGENT_TASKS_DISABLED) : true,
      name: 'smartAgentTasks',
      ethAccount: '0xa60F5EAfBb782793d7589bc5F55BfA3a599B182d',
    }
  }
}
