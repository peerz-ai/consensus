import "@solarity/hardhat-migrate";
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import '@solarity/hardhat-markup';
import '@typechain/hardhat';
import { HardhatUserConfig } from 'hardhat/config';
import 'solidity-coverage';
import 'tsconfig-paths/register';

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
    },
    holesky: {
      url: "https://rpc.ankr.com/eth_holesky",
      accounts: ['8a144065afe2d2e1ad87e848056de0efa2f225937f75d9eb216a9b40e32bdddf'],
      gasMultiplier: 1.2,
    },
    sepolia: {
      url: "https://ethereum-sepolia.rpc.subquery.network/public",
      accounts: ['8a144065afe2d2e1ad87e848056de0efa2f225937f75d9eb216a9b40e32bdddf'],
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
      mainnet: 'KGC4BRB1N8WVMS46PGQH6S4AY6DNXAQHNT',
      holesky: 'KGC4BRB1N8WVMS46PGQH6S4AY6DNXAQHNT',
      sepolia: 'KGC4BRB1N8WVMS46PGQH6S4AY6DNXAQHNT',
    }
  }
};

export default config;
