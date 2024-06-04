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

    it('should handle fractional maxSupply correctly', async () => {
      maxSupply = wei(500.5);
      currentTime = startTime + initialPeriod / 2;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const expectedReward = (maxSupply * BigInt(20) / BigInt(100)) / BigInt(90) * BigInt(45); // 20% of maxSupply over 90 days, half period

      expect(reward).to.eq(expectedReward);
    });

    it('should handle zero maxSupply correctly', async () => {
      maxSupply = wei(0);
      currentTime = startTime + initialPeriod / 2;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);

      expect(reward).to.eq(wei(0));
    });

    it('should handle updates exactly two years minus one day after start time', async () => {
      lastUpdate = startTime + oneYear;
      currentTime = lastUpdate + oneYear - oneDay; // exactly two years after initial period
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const dailyReward = initialDailyReward / BigInt(2); // halved after first year
      const secondYearReward = dailyReward / BigInt(2); // halved again after second year
      const expectedReward = secondYearReward * BigInt(364); // one year of rewards after two years

      expect(reward).to.eq(expectedReward);
    });

    it('should handle updates exactly one minute after two years', async () => {
      lastUpdate = startTime + 2 * oneYear;
      currentTime = lastUpdate + 60; // exactly two years after initial period
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const dailyReward = initialDailyReward / BigInt(2); // halved after first year
      const secondYearReward = dailyReward / BigInt(2); // halved again after second year
      const thirdYearReward = secondYearReward / BigInt(2); // halved again after third year

      expect(reward).to.eq(thirdYearReward * BigInt(60) / BigInt(oneDay)); // 1 minute reward after two years
    });

    it('should handle updates with maxSupply as a large prime number', async () => {
      maxSupply = wei(982451653); // large prime number
      currentTime = startTime + initialPeriod / 2;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const expectedReward = (maxSupply * BigInt(20) / BigInt(100)) / BigInt(90) * BigInt(45); // 20% of maxSupply over 90 days, half period

      expect(reward).to.eq(expectedReward);
    });

    it('should handle updates with maxSupply as a small prime number', async () => {
      maxSupply = wei(17); // small prime number
      currentTime = startTime + initialPeriod / 2;
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const expectedReward = (maxSupply * BigInt(20) / BigInt(100)) / BigInt(90) * BigInt(45); // 20% of maxSupply over 90 days, half period

      expect(reward).to.eq(expectedReward);
    });

    it('should handle updates for a leap second', async () => {
      lastUpdate = startTime + initialPeriod + 60;
      currentTime = lastUpdate + 1; // exactly one year and one leap second after initial period
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const postInitialReward = initialDailyReward / BigInt(2); // halved reward after initial period

      expect(reward).to.eq(postInitialReward / BigInt(oneDay)); // 1 second
    });

    it('should handle updates ten years after start', async () => {
      lastUpdate = startTime + 10 * oneYear + oneDay;
      currentTime = lastUpdate + 60; // exactly ten years after initial period
      const reward = await lib.calculateAccumulatedDistribution(maxSupply, startTime, lastUpdate, currentTime);
      const dailyReward = initialDailyReward / BigInt(2); // halved after first year
      const secondYearReward = dailyReward / BigInt(2); // halved again after second year
      const thirdYearReward = secondYearReward / BigInt(2); // halved again after third year
      const fourthYearReward = thirdYearReward / BigInt(2); // halved again after fourth year
      const fifthYearReward = fourthYearReward / BigInt(2); // halved again after fifth year
      const sixthYearReward = fifthYearReward / BigInt(2); // halved again after sixth year
      const seventhYearReward = sixthYearReward / BigInt(2); // halved again after seventh year
      const eighthYearReward = seventhYearReward / BigInt(2); // halved again after eighth year
      const ninthYearReward = eighthYearReward / BigInt(2); // halved again after ninth year
      const tenthYearReward = ninthYearReward / BigInt(2); // halved again after tenth year
      const eleventhYearReward = tenthYearReward / BigInt(2); // halved again after eleventh year

      expect(reward).to.eq(eleventhYearReward * BigInt(60) / BigInt(oneDay)); // 1 minute reward after ten years
    });
  });
});
