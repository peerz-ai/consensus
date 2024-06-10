import "@solarity/hardhat-migrate";
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import '@solarity/hardhat-markup';
import '@typechain/hardhat';
import * as dotenv from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';
import 'solidity-coverage';
import 'tsconfig-paths/register';

dotenv.config();

function typechainTarget() {
  const target = process.env.TYPECHAIN_TARGET;

  return target === '' || target === undefined ? 'ethers-v6' : target;
}

function forceTypechain() {
  return process.env.TYPECHAIN_FORCE === 'false';
}

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: 'paris',
    },
  },
  networks: {
    hardhat: {
      accounts: {
        count: 20,
      }
    },
    holesky: {
      url: "https://rpc.ankr.com/eth_holesky",
      accounts: [process.env.PRIVATE_KEY || ''],
      gasMultiplier: 1.2,
    },
    sepolia: {
      url: "https://ethereum-sepolia.rpc.subquery.network/public",
      accounts: [process.env.PRIVATE_KEY || ''],
      gasMultiplier: 1.2,
    }
  },
  typechain: {
    outDir: `generated-types/${typechainTarget().split('-')[0]}`,
    target: typechainTarget(),
    alwaysGenerateOverloads: true,
    discriminateTypes: true,
    dontOverrideCompile: forceTypechain(),
  },
  migrate: {
    from: -1,
    to: -1,
    only: -1,
    skip: -1,
    wait: 1,
    verificationDelay: 5000,
    verify: false,
    verifyParallel: 1,
    verifyAttempts: 3,
    pathToMigrations: "./deploy",
    force: false,
    continue: false,
    transactionStatusCheckInterval: 2000,
  },
  etherscan: {
    apiKey: {
      mainnet: String(process.env.ETHERSCAN_KEY),
      holesky: String(process.env.ETHERSCAN_KEY),
      sepolia: String(process.env.ETHERSCAN_KEY),
    }
  }
};

export default config;
