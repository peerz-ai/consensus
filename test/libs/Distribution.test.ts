import { expect } from 'chai';
import { ethers } from 'hardhat';

import { Distribution } from '@/generated-types/ethers';
import { wei } from '@/scripts/utils/utils';
import { Reverter } from '@/test/helpers/reverter';
import { getCurrentBlockTime, setNextTime } from '../helpers/block-helper';

export const oneDay = 86400;
export const oneHour = 3600;
export const oneYear = 31536000;
export const initialPeriod = 90 * oneDay;

describe('Distribution', () => {
  const reverter = new Reverter();

  let lib: Distribution;

  let startTime: number;
  let maxSupply: bigint;
  let lastUpdate: number;
  let currentTime: number;
  let initialDailyReward: bigint;

  before(async () => {
    const [libFactory] = await Promise.all([ethers.getContractFactory('Distribution')]);
    lib = await libFactory.deploy();

    await reverter.snapshot();
  });

  afterEach(reverter.revert);

  describe('#calculateAccumulatedDistribution', () => {
    beforeEach(async () => {
      startTime = await getCurrentBlockTime();
      maxSupply = wei(10000000);
      lastUpdate = startTime;
      currentTime = startTime;
      const initialReward = (maxSupply * BigInt(20) / BigInt(100)); // 20% of maxSupply over 90 days
      initialDailyReward = initialReward / BigInt(90); // daily reward during initial period
    });

    it('should return 0 if lastUpdate equals currentTime', async () => {
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      expect(reward).to.eq(wei(0));
    });

    it('should return 0 if currentTime is before startTime', async () => {
      currentTime = startTime - oneHour;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      expect(reward).to.eq(wei(0));
    });

    it('should calculate distribution correctly for the initial period', async () => {
      currentTime = startTime + initialPeriod / 2;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const expectedReward = initialDailyReward * BigInt(45); // 20% of maxSupply over 90 days, half period
      expect(reward).to.eq(expectedReward);
    });

    it('should calculate distribution correctly after the initial period', async () => {
      lastUpdate = startTime + initialPeriod;
      currentTime = lastUpdate + (oneDay / 2);
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const dailyRewardSecondPeriod = initialDailyReward / BigInt(2); // halved after 3 months

      expect(reward).to.eq(dailyRewardSecondPeriod / BigInt(2));
    });

    it('should calculate distribution correctly after the initial period', async () => {
      lastUpdate = startTime + initialPeriod;
      currentTime = lastUpdate + oneDay;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const dailyRewardSecondPeriod = initialDailyReward / BigInt(2); // halved after 3 months

      expect(reward).to.eq(dailyRewardSecondPeriod * BigInt(1)); // 1 day reward after initial period
    });

    it('should apply halving correctly after first year', async () => {
      lastUpdate = startTime + initialPeriod + oneYear;
      currentTime = lastUpdate + 60;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const dailyReward = initialDailyReward / BigInt(2) / BigInt(2); // after one year - reward after two halvings
      expect(reward).to.eq(dailyReward * BigInt(60) / BigInt(oneDay));
    });

    it('should apply halving correctly after 365 days for 7 days', async () => {
      lastUpdate = startTime + initialPeriod + oneYear - oneDay;
      currentTime = lastUpdate + 7 * oneDay;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      
      const postInitialReward = initialDailyReward / BigInt(2); // halved reward after the initial period
      const secondYearReward = postInitialReward / BigInt(2);

      expect(reward).to.eq(secondYearReward * BigInt(7)); // 7 days reward after the first year halving
    });

    it('should handle updates exactly at the end of initial period', async () => {
      lastUpdate = startTime;
      currentTime = lastUpdate + initialPeriod; // exactly at the end of initial period
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);

      expect(reward).to.eq(initialDailyReward * BigInt(90)); // 90 days of rewards
    });

    it('should handle updates exactly one year after initial period', async () => {
      lastUpdate = startTime + initialPeriod;
      currentTime = lastUpdate + oneYear; // exactly one year after initial period
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const dailyReward = initialDailyReward / BigInt(2) / BigInt(2); // halved after first year
      const expectedReward = dailyReward * BigInt(365); // one year of rewards after initial period

      expect(reward).to.eq(expectedReward);
    });

    /* it('should handle updates spanning initial and post-initial periods', async () => {
      lastUpdate = startTime + initialPeriod - oneDay;
      currentTime = lastUpdate + oneWeek; // spans across the initial and post-initial period
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const initialReward = initialDailyReward; // reward for the last day of initial period
      const postInitialReward = initialDailyReward / BigInt(2); // halved reward after initial period
      const expectedReward = initialReward + (postInitialReward * BigInt(6)); // 1 day of initial + 6 days of post-initial

      expect(reward).to.eq(expectedReward);
    }); */

    it('should handle small maxSupply over a long period', async () => {
      lastUpdate = startTime + oneYear * 5;
      currentTime = lastUpdate + oneDay; // a day after 5 years
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const postInitialReward = initialDailyReward / BigInt(2); // 0 - 1
      const secondYearReward = postInitialReward / BigInt(2); // 1 - 2
      const thirdYearReward = secondYearReward / BigInt(2); // 2 - 3
      const fourthYearReward = thirdYearReward / BigInt(2); // 3 - 4
      const fifthYearReward = fourthYearReward / BigInt(2); // 4 - 5
      const sixthYearReward = fifthYearReward / BigInt(2); // 5 - 6

      expect(reward).to.eq(sixthYearReward); // day post 5 years
    });

  });
});
