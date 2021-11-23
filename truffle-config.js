const HDWalletProvider = require('@truffle/hdwallet-provider');
 
module.exports = {
  compilers: {
    solc: {
      version: "0.8.0", // A version or constraint - Ex. "^0.5.0"
                         // Can also be set to "native" to use a native solc
      docker: false, // Use a version obtained through docker
      parser: "solcjs",  // Leverages solc-js purely for speedy parsing
      settings: {
        optimizer: {
          enabled: true,
          runs: 200   // Optimize for how many times you intend to run the code
        },
        evmVersion: "berlin"
      }
    }
  },

  mocha: {
    enableTimeouts: false,
    before_timeout: 480000
  },
 
  networks: {
    theta_privatenet: {
      provider: () => {
        // private key for test wallet #1: 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A 
        var privateKeyTest1 = '1111111111111111111111111111111111111111111111111111111111111111';
 
        // private key for test wallet #2: 0x1563915e194D8CfBA1943570603F7606A3115508
        var privateKeyTest2 = '2222222222222222222222222222222222222222222222222222222222222222';
 
        return new HDWalletProvider({
          privateKeys: [privateKeyTest1, privateKeyTest2],
          providerOrUrl: 'http://localhost:18888/rpc',
        });
      },
      network_id: 366,
      gasPrice: 4000000000000,
    },
 
    theta_testnet: {
      provider: () => {
 
        // Replace the private key below with the private key of the deployer wallet. 
        // Make sure the deployer wallet has a sufficient amount of TFuel, e.g. 100 TFuel
        var deployerPrivateKey = '';
 
        return new HDWalletProvider({
          privateKeys: [deployerPrivateKey],
          providerOrUrl: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
        });
      },
      network_id: 365,
      gasPrice: 4000000000000,
    },

    theta_mainnet: {
      provider: () => {
 
        // Replace the private key below with the private key of the deployer wallet. 
        // Make sure the deployer wallet has a sufficient amount of TFuel, e.g. 100 TFuel
        var deployerPrivateKey = '';
 
        return new HDWalletProvider({
          privateKeys: [deployerPrivateKey],
          providerOrUrl: 'https://eth-rpc-api.thetatoken.org/rpc',
        });
      },
      network_id: 361,
      gasPrice: 4000000000000,
    }
  }
};