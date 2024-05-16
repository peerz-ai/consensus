import { expect } from 'chai';
import { ethers } from 'hardhat';

import { IConsensus, ConsensusV2 } from '@/generated-types/ethers';
import { wei } from '@/scripts/utils/utils';
import { Reverter } from '@/test/helpers/reverter';
import { getCurrentBlockTime } from '../helpers/block-helper';

export const oneDay = 86400;
export const oneHour = 3600;

describe('Distribution', () => {
  const reverter = new Reverter();

  let consensus: ConsensusV2;

  let startTime: number;
  let maxSupply: bigint;
  let lastUpdate: number;
  let currentTime: number;

  before(async () => {
    const [libFactory] = await Promise.all([ethers.getContractFactory('Distribution')]);
    const lib = await libFactory.deploy();

    const consensusFactory = await ethers.getContractFactory('ConsensusV2', {
      libraries: {
        Distribution: await lib.getAddress(),
      },
    });

    consensus = await consensusFactory.deploy();

    await reverter.snapshot();
  });

  afterEach(reverter.revert);

  describe('#calculateAccumulatedDistribution', () => {
    beforeEach(async () => {

      startTime = await getCurrentBlockTime();
      maxSupply = wei(10000000);
      lastUpdate = startTime;
      currentTime = startTime;
    });

    it('should return 0 if lastUpdate equals currentTime', async () => {
      const reward = await consensus.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      expect(reward).to.eq(wei(0));
    });

    it('should return 0 if startTime equals startTime', async () => {
      const reward = await consensus.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate + 60, currentTime);
      expect(reward).to.eq(wei(0));
    });
  });
});
