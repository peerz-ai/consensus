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
  typechain: {
    outDir: `generated-types/${typechainTarget().split('-')[0]}`,
    target: typechainTarget(),
    alwaysGenerateOverloads: true,
    discriminateTypes: true,
    dontOverrideCompile: forceTypechain(),
  },
};

export default config;
