import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { generatePeerID, getDefaultNetworkState } from './helpers/network-helper';

import {
  Consensus,
  ConsensusV2,
  Consensus__factory,
  IConsensus,
  L1MessageReceiver,
  L2Sender,
  LZEndpointMock,
  Distribution,
  PRZ,
} from '@/generated-types/ethers';
import { ZERO_ADDR } from '@/scripts/utils/constants';
import { fromWei, wei } from '@/scripts/utils/utils';
import { getCurrentBlockTime, setTime } from '@/test/helpers/block-helper';
import { Reverter } from '@/test/helpers/reverter';

export const oneDay = 86400;

describe('Consensus', function () {
  const senderChainId = 110;
  const receiverChainId = 101;

  const reverter = new Reverter();

  let OWNER: SignerWithAddress;
  let SECOND: SignerWithAddress;

  let ownerAddress: string;
  let secondAddress: string;

  let consensusFactory: Consensus__factory;
  let consensus: Consensus;

  let lib: Distribution;

  let rewardToken: PRZ;

  let l2Sender: L2Sender;
  let l1MessageReceiver: L1MessageReceiver;

  let lZEndpointMockSender: LZEndpointMock;
  let lZEndpointMockReceiver: LZEndpointMock;

  before(async () => {
    await ethers.provider.send('hardhat_reset');

    [OWNER, SECOND] = await ethers.getSigners();

    [ownerAddress, secondAddress] = await Promise.all([OWNER.getAddress(), SECOND.getAddress()]);

    const [libFactory, ERC1967ProxyFactory, PRZFactory, l2SenderFactory, L1MessageReceiver, LZEndpointMock] =
      await Promise.all([
        ethers.getContractFactory('Distribution'),
        ethers.getContractFactory('ERC1967Proxy'),
        ethers.getContractFactory('PRZ'),
        ethers.getContractFactory('L2Sender'),
        ethers.getContractFactory('L1MessageReceiver'),
        ethers.getContractFactory('LZEndpointMock'),
      ]);

    let l1MessageReceiverImplementation: L1MessageReceiver;
    let l2SenderImplementation: L2Sender;
    // START deploy contracts without deps
    [
      lib,
      l1MessageReceiver,
      lZEndpointMockSender,
      lZEndpointMockReceiver,
      l1MessageReceiverImplementation,
      l2SenderImplementation,
    ] = await Promise.all([
      libFactory.deploy(),
      L1MessageReceiver.deploy(),
      LZEndpointMock.deploy(senderChainId),
      LZEndpointMock.deploy(receiverChainId),
      L1MessageReceiver.deploy(),
      l2SenderFactory.deploy(),
    ]);

    consensusFactory = await ethers.getContractFactory('Consensus', {
      libraries: {
        Distribution: await lib.getAddress(),
      },
    });
    const consensusImplementation = await consensusFactory.deploy();
    // END

    const l1MessageReceiverProxy = await ERC1967ProxyFactory.deploy(l1MessageReceiverImplementation, '0x');
    l1MessageReceiver = L1MessageReceiver.attach(l1MessageReceiverProxy) as L1MessageReceiver;
    await l1MessageReceiver.L1MessageReceiver__init();

    // START deploy consensus contract
    const consensusProxy = await ERC1967ProxyFactory.deploy(await consensusImplementation.getAddress(), '0x');
    consensus = consensusFactory.attach(await consensusProxy.getAddress()) as Consensus;
    // END

    const l2SenderProxy = await ERC1967ProxyFactory.deploy(l2SenderImplementation, '0x');
    l2Sender = l2SenderFactory.attach(l2SenderProxy) as L2Sender;
    await l2Sender.L2Sender__init(consensus, {
      gateway: lZEndpointMockSender,
      receiver: l1MessageReceiver,
      receiverChainId: receiverChainId,
      zroPaymentAddress: ZERO_ADDR,
      adapterParams: '0x',
    });

    // Deploy reward token
    rewardToken = await PRZFactory.deploy(wei(100000000000000));

    await rewardToken.transferOwnership(await l1MessageReceiver.getAddress());

    await l1MessageReceiver.setParams(rewardToken, {
      gateway: lZEndpointMockReceiver,
      sender: l2Sender,
      senderChainId: senderChainId,
    });

    await lZEndpointMockSender.setDestLzEndpoint(l1MessageReceiver, lZEndpointMockReceiver);

    await consensus.Consensus_init(l2Sender, (await getCurrentBlockTime()) + (oneDay / 2), await rewardToken.cap());

    await reverter.snapshot();
  });

  afterEach(reverter.revert);

  describe('setL2Sender', () => {
    it('should set the L2 sender address', async () => {
      await consensus.setL2Sender(secondAddress);
      expect(await consensus.l2Sender()).to.equal(secondAddress);
    });

    it('should revert if called by non-owner', async () => {
      await expect(consensus.connect(SECOND).setL2Sender(secondAddress))
        .to.be.revertedWithCustomError(consensus, 'OwnableUnauthorizedAccount');
    });
  });

  describe('setValidator', () => {
    it('should set a validator', async () => {
      await consensus.setValidator(secondAddress, true);
      expect(await consensus.validators(secondAddress)).to.be.true;
    });

    it('should unset a validator', async () => {
      await consensus.setValidator(secondAddress, true);
      await consensus.setValidator(secondAddress, false);
      expect(await consensus.validators(secondAddress)).to.be.false;
    });

    it('should revert if called by non-owner', async () => {
      await expect(consensus.connect(SECOND).setValidator(secondAddress, true))
        .to.be.revertedWithCustomError(consensus, 'OwnableUnauthorizedAccount');
    });
  });

  describe('registerPeer', () => {
    it('should register a peer', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      expect(await consensus.peers(peerId)).to.equal(secondAddress);
      expect(await consensus.contributions(peerId)).to.equal(250);
      expect(await consensus.totalContributions()).to.equal(250);
    });
    it('should revert if contribution is zero', async () => {
      const peerId = generatePeerID();
      await expect(consensus.connect(SECOND).registerPeer(peerId, 0)).to.be.revertedWithCustomError(
        consensus,
        "InvalidContribution"
      );
    });

    it('should revert if peer is already registered', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await expect(consensus.connect(SECOND).registerPeer(peerId, 250)).to.be.revertedWithCustomError(
        consensus,
        "PeerExists"
      );
    });

    it('should register multiple peers and update total contributions', async () => {
      const peerId1 = generatePeerID();
      const peerId2 = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId1, 250);
      await consensus.connect(SECOND).registerPeer(peerId2, 300);
      expect(await consensus.totalContributions()).to.equal(550);
    });
  });

  describe('updatePeerContribution', () => {
    it('should update peer contribution', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await consensus.connect(SECOND).updatePeerContribution(peerId, 500);
      expect(await consensus.contributions(peerId)).to.equal(500);
      expect(await consensus.totalContributions()).to.equal(500);
    });

    it('should revert if not called by peer', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await expect(consensus.updatePeerContribution(peerId, 500)).to.be.revertedWithCustomError(
        consensus,
        "PeerNotAuthorized"
      );
    });

    it('should revert if contribution is zero', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await expect(consensus.connect(SECOND).updatePeerContribution(peerId, 0)).to.be.revertedWithCustomError(
        consensus,
        "InvalidContribution"
      );
    });
  });

  describe('updatePeerAddress', () => {
    it('should update peer address', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await consensus.connect(SECOND).updatePeerAddress(peerId, ownerAddress);
      expect(await consensus.peers(peerId)).to.equal(ownerAddress);
    });

    it('should revert if not called by peer', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await expect(consensus.updatePeerAddress(peerId, ownerAddress)).to.be.revertedWithCustomError(
        consensus,
        "PeerNotAuthorized"
      );
    });
  });

  describe('deactivatePeer', () => {
    it('should deactivate a peer', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await consensus.connect(SECOND).deactivatePeer(peerId);
      expect(await consensus.contributions(peerId)).to.equal(0);
      expect(await consensus.totalContributions()).to.equal(0);
    });

    it('should revert if not called by peer', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await expect(consensus.deactivatePeer(peerId)).to.be.revertedWithCustomError(
        consensus,
        "PeerNotAuthorized"
      );
    });

    it('should revert if peer is not registered', async () => {
      const peerId = generatePeerID();
      await expect(consensus.connect(SECOND).deactivatePeer(peerId)).to.be.revertedWithCustomError(
        consensus,
        "PeerNotAuthorized"
      );
    });
  });

  describe('getActivePeers', () => {
    it('should get active peers', async () => {
      const peerId = generatePeerID();
      const peerId2 = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await consensus.connect(SECOND).registerPeer(peerId2, 250);
      const activePeers = await consensus.getActivePeers();
      expect(activePeers[0]).to.equal(2);
      expect(activePeers[1]).to.equal(500);
    });

    it('should get active peers range', async () => {
      const peerId = generatePeerID();
      const peerId2 = generatePeerID();
      const peerId3 = generatePeerID();
      const peerId4 = generatePeerID();
      const peerId5 = generatePeerID();

      await consensus.connect(SECOND).registerPeer(peerId, 250);
      await consensus.connect(SECOND).registerPeer(peerId2, 200);
      await consensus.connect(SECOND).registerPeer(peerId3, 150);
      await consensus.connect(SECOND).registerPeer(peerId4, 100);
      await consensus.connect(SECOND).registerPeer(peerId5, 50);

      const activePeers = await consensus.getActivePeersRange(1, 3);
      expect(activePeers[0][0]).to.equal(peerId2);
      expect(activePeers[0][1]).to.equal(peerId3);
      expect(activePeers[0][2]).to.equal(peerId4);
      expect(activePeers[1][0]).to.equal(200);
      expect(activePeers[1][1]).to.equal(150);
      expect(activePeers[1][2]).to.equal(100);
    });
  });


  describe('validate', () => {
    it('should validate 20% distributed the first 90 days', async () => {
      const peerId = generatePeerID();

      await consensus.connect(SECOND).registerPeer(peerId, 250);

      const lastUpdate = await consensus.rewardStart() + BigInt(oneDay * 90);
      await setTime(Number(lastUpdate) - 1);

      await consensus.connect(SECOND).deactivatePeer(peerId);

      const initialDailyReward = await rewardToken.cap() * BigInt(20) / BigInt(100) / BigInt(90);

      expect(await consensus.rewards(peerId)).to.be.equal(initialDailyReward * BigInt(90));
    });

    it('should report a peer', async () => {
      const peerId = generatePeerID();

      await consensus.setValidator(ownerAddress, true);
      await consensus.connect(SECOND).registerPeer(peerId, 250);

      const lastUpdate = await getCurrentBlockTime();
      await setTime(lastUpdate + oneDay);

      await consensus.reportPeer(peerId);
      expect(await consensus.rewards(peerId)).to.be.gt(0);
    });

    it('should revert if not the peer address trying to deactivate', async () => {
      const peerId = generatePeerID();

      await consensus.connect(SECOND).registerPeer(peerId, 250);

      const lastUpdate = await consensus.rewardStart() + BigInt(oneDay * 90);
      await setTime(Number(lastUpdate));

      await expect(consensus.deactivatePeer(peerId))
        .to.be.revertedWithCustomError(
          consensus,
          'PeerNotAuthorized'
        );
    });

    it('should revert if no validators', async () => {
      const peerId = generatePeerID();
      await consensus.connect(SECOND).registerPeer(peerId, 250);

      await expect(consensus.reportPeer(peerId))
        .to.be.revertedWithCustomError(
          consensus,
          'ValidatorNotAuthorized'
        );
    });

    it('should revert if peer is not active', async () => {
      const peerId = generatePeerID();

      await consensus.setValidator(ownerAddress, true);

      await expect(consensus.reportPeer(peerId))
        .to.be.revertedWithCustomError(
          consensus,
          'PeerNotActive'
        );
    });

    it('should revert if consensus is not reached', async () => {
      const peerId = generatePeerID();
      const peerId2 = generatePeerID();

      await consensus.connect(SECOND).registerPeer(peerId, 20);

      const validators = [ownerAddress, secondAddress];
      const signatures = [
        await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
          ['bytes32'], [peerId]
        ))),
        await SECOND.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
          ['bytes32'], [peerId2]
        )))
      ];

      await consensus.setValidator(ownerAddress, true);
      await consensus.setValidator(secondAddress, true);

      await expect(consensus.reportPeer(signatures, validators, peerId))
        .to.be.revertedWith('Consensus not reached');
    });

    it('Should set the correct network state', async function () {
      const signers = await ethers.getSigners();
      // first half are validators and the rest are peers
      const validatorsSigners = signers.slice(0, signers.length * 0.2);
      const peersSigners = signers.slice(signers.length * 0.2);
  
      const peers = await getDefaultNetworkState(peersSigners.length);
  
      const peerIds = await Promise.all(peers.map((x) => x.peerId)); // peerId
      const contributions = peers.map((x) => x.contribution); // contribution
  
      await Promise.all(
        peerIds.map(async (peerId, index) => consensus.connect(peersSigners[index]).registerPeer(peerId, contributions[index])),
      );
  
      await Promise.all(
        validatorsSigners.map(async (validator, index) => consensus.setValidator(validator, true)),
      );
  
      const lastUpdate = await getCurrentBlockTime();
      await setTime(lastUpdate + oneDay);

      await Promise.all(
        validatorsSigners.slice(validatorsSigners.length * 2 / 3).map(async (validator, index) => consensus.connect(validator).reportPeer(
          peerIds[0],
        )),
      );

      const balance = await consensus.validatorRewards(SECOND);

      /* const validatorBalance = await consensus.validatorRewards(validatorsSigners[validatorsSigners.length - 1].address);
      expect(validatorBalance).to.be.gt(0); */

      const peerBalance = await consensus.earned(peerIds[0]);
      expect(peerBalance).to.be.gt(0);
  
    });
  });

  describe('claim', () => {
    it('should allow user to claim rewards', async () => {
      const peerId = generatePeerID();

      await consensus.setValidator(ownerAddress, true);
      await consensus.registerPeer(peerId, 250);

      const lastUpdate = await getCurrentBlockTime();
      await setTime(lastUpdate + oneDay);

      const initialBalance = await rewardToken.balanceOf(ownerAddress);

      const mintPayload = rewardToken.interface.encodeFunctionData('mint', [ownerAddress, wei(100)]);

      const estimatedFees = await lZEndpointMockReceiver.estimateFees(
        receiverChainId,
        await rewardToken.getAddress(),
        mintPayload,
        false,
        '0x'
      );

      await consensus.claim(peerId, {value: estimatedFees[0]});

      const finalBalance = await rewardToken.balanceOf(ownerAddress);

      expect(finalBalance).to.be.gt(initialBalance);
    });

    it('should allow validators to claim their rewards', async () => {
      const peerId = generatePeerID();

      await consensus.setValidator(ownerAddress, true);
      await consensus.registerPeer(peerId, 250);

      const lastUpdate = await getCurrentBlockTime();
      await setTime(lastUpdate + oneDay);

      const initialBalance = await rewardToken.balanceOf(ownerAddress);

      const mintPayload = rewardToken.interface.encodeFunctionData('mint', [ownerAddress, wei(100)]);

      const estimatedFees = await lZEndpointMockReceiver.estimateFees(
        receiverChainId,
        await rewardToken.getAddress(),
        mintPayload,
        false,
        '0x'
      );

      await consensus.claim(peerId, {value: estimatedFees[0]});

      const finalBalance = await rewardToken.balanceOf(ownerAddress);

      expect(finalBalance).to.be.gt(initialBalance);
    });

    it('should revert if rewards not started yet', async () => {
      const peerId = generatePeerID();

      await expect(consensus.claim(peerId)).to.be.revertedWithCustomError(
        consensus,
        'RewardsNotStarted'
      );
    });

    it('should revert if nothing to claim', async () => {
      const peerId = generatePeerID();

      await setTime((await getCurrentBlockTime()) + oneDay);
      await expect(consensus.claim(peerId)).to.be.revertedWithCustomError(
        consensus,
        "NothingToClaim"
      );
    });

    it('should revert if not enough to pay lz fees', async () => {
      const peerId = generatePeerID();

      await consensus.setValidator(ownerAddress, true);
      await consensus.registerPeer(peerId, 250);

      const lastUpdate = await getCurrentBlockTime();
      await setTime(lastUpdate + oneDay);

      await expect(consensus.claim(peerId)).to.be.revertedWith("LayerZeroMock: not enough native for fees");
    });
  });

  describe('Consensus Integration Tests', function () {
    it('should handle multiple peers joining and deactivating at different times', async () => {
        const peerId1 = generatePeerID();
        const peerId2 = generatePeerID();
        const peerId3 = generatePeerID();

        // Peer 1 joins
        await consensus.connect(SECOND).registerPeer(peerId1, 250);
        expect(await consensus.totalContributions()).to.equal(250);

        // Advance time by one day
        const lastUpdate = await getCurrentBlockTime();
        await setTime(lastUpdate + oneDay);

        // Peer 2 joins
        await consensus.connect(SECOND).registerPeer(peerId2, 300);
        expect(await consensus.totalContributions()).to.equal(550);

        // Advance time by another day
        await setTime(lastUpdate + oneDay * 2);

        // Peer 1 deactivates
        await consensus.connect(SECOND).deactivatePeer(peerId1);
        expect(await consensus.totalContributions()).to.equal(300);
        expect(await consensus.contributions(peerId1)).to.equal(0);

        // Peer 3 joins
        await consensus.connect(SECOND).registerPeer(peerId3, 400);
        expect(await consensus.totalContributions()).to.equal(700);

        // Advance time by another day
        await setTime(lastUpdate + oneDay * 3);

        // Peer 2 deactivates
        await consensus.connect(SECOND).deactivatePeer(peerId2);
        expect(await consensus.totalContributions()).to.equal(400);
        expect(await consensus.contributions(peerId2)).to.equal(0);
    });

    it('should handle peers getting reported and validators receiving rewards', async () => {
        const peerId1 = generatePeerID();
        const peerId2 = generatePeerID();

        await consensus.setValidator(ownerAddress, true);

        // Peers join
        await consensus.connect(SECOND).registerPeer(peerId1, 250);
        await consensus.connect(SECOND).registerPeer(peerId2, 300);

        const lastUpdate = await getCurrentBlockTime();
        await setTime(lastUpdate + oneDay);

        const initialBalance = await rewardToken.balanceOf(ownerAddress);

        const mintPayload = rewardToken.interface.encodeFunctionData('mint', [ownerAddress, wei(100)]);
        const estimatedFees = await lZEndpointMockReceiver.estimateFees(
            receiverChainId,
            await rewardToken.getAddress(),
            mintPayload,
            false,
            '0x'
        );

        const signatures = [
            await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['bytes32'], [peerId1]))),
        ];
        const validators = [ownerAddress];

        // Report Peer 1
        await consensus.reportPeer(signatures, validators, peerId1);

        const validatorReward = await consensus.validatorRewards(ownerAddress);
        expect(validatorReward).to.be.gt(0);

        await consensus.claim(peerId1, {value: estimatedFees[0]});
        await consensus.claim(ethers.encodeBytes32String(""), {value: estimatedFees[0]});

        const finalBalance = await rewardToken.balanceOf(ownerAddress);
        expect(finalBalance).to.be.gt(initialBalance);

        const peer1Balance = await consensus.earned(peerId1);
        expect(peer1Balance).to.equal(0);

        const peer2Balance = await consensus.earned(peerId2);
        expect(peer2Balance).to.be.gt(0);
    });

    it('should distribute rewards correctly among multiple peers and validators', async () => {
        const peerId1 = generatePeerID();
        const peerId2 = generatePeerID();
        const peerId3 = generatePeerID();

        await consensus.setValidator(ownerAddress, true);
        await consensus.setValidator(secondAddress, true);

        // Peers join
        await consensus.connect(SECOND).registerPeer(peerId1, 250);
        await consensus.connect(SECOND).registerPeer(peerId2, 300);
        await consensus.connect(SECOND).registerPeer(peerId3, 200);

        const lastUpdate = await getCurrentBlockTime();
        await setTime(lastUpdate + oneDay);

        const signatures = [
            await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['bytes32'], [peerId1]))),
            await SECOND.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['bytes32'], [peerId1]))),
        ];
        const validators = [ownerAddress, secondAddress];

        // Report Peer 1
        await consensus.reportPeer(signatures, validators, peerId1);

        const validatorRewardOwner = await consensus.validatorRewards(ownerAddress);
        const validatorRewardSecond = await consensus.validatorRewards(secondAddress);
        expect(validatorRewardOwner).to.be.gt(0);
        expect(validatorRewardSecond).to.be.gt(0);

        const peer1Rewards = await consensus.earned(peerId1);
        expect(peer1Rewards).to.be.gt(0);

        const peer3Rewards = await consensus.earned(peerId3);

        // Claim rewards
        const mintPayload = rewardToken.interface.encodeFunctionData('mint', [ownerAddress, wei(100)]);
        const estimatedFees = await lZEndpointMockReceiver.estimateFees(
            receiverChainId,
            await rewardToken.getAddress(),
            mintPayload,
            false,
            '0x'
        );

        await consensus.claim(peerId1, {value: estimatedFees[0]});
        await consensus.claim(peerId2, {value: estimatedFees[0]});
        await consensus.claim(peerId3, {value: estimatedFees[0]});

        await setTime(await getCurrentBlockTime() + oneDay);

        // Check final balances
        const finalBalanceOwner = await rewardToken.balanceOf(ownerAddress);
        const finalBalanceSecond = await rewardToken.balanceOf(secondAddress);

        expect(finalBalanceOwner).to.eq(0);
        expect(finalBalanceSecond).to.be.gt(0);

        const finalPeer1Balance = await consensus.earned(peerId1);
        const finalPeer2Balance = await consensus.earned(peerId2);
        const finalPeer3Balance = await consensus.earned(peerId3);

        expect(finalPeer1Balance).to.equal(0);
        expect(finalPeer2Balance).to.be.gt(0);
        expect(finalPeer3Balance).to.be.gt(0);
    });

    it('should handle complex scenario with multiple peers and validators', async () => {
        const peerId1 = generatePeerID();
        const peerId2 = generatePeerID();
        const peerId3 = generatePeerID();
        const peerId4 = generatePeerID();

        await consensus.setValidator(ownerAddress, true);
        await consensus.setValidator(secondAddress, true);

        // Peers join
        await consensus.connect(SECOND).registerPeer(peerId1, 250);
        await consensus.connect(SECOND).registerPeer(peerId2, 300);
        await consensus.connect(SECOND).registerPeer(peerId3, 200);
        await consensus.connect(SECOND).registerPeer(peerId4, 150);

        const lastUpdate = await getCurrentBlockTime();
        await setTime(lastUpdate + oneDay);

        // Peer 2 deactivates
        await consensus.connect(SECOND).deactivatePeer(peerId2);

        const signatures1 = [
            await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['bytes32'], [peerId1]))),
            await SECOND.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['bytes32'], [peerId1]))),
        ];
        const validators = [ownerAddress, secondAddress];

        // Report Peer 1
        await consensus.reportPeer(signatures1, validators, peerId1);

        const validatorRewardOwner1 = await consensus.validatorRewards(ownerAddress);
        const validatorRewardSecond1 = await consensus.validatorRewards(secondAddress);
        expect(validatorRewardOwner1).to.be.gt(0);
        expect(validatorRewardSecond1).to.be.gt(0);

        const signatures3 = [
            await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['bytes32'], [peerId3]))),
            await SECOND.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['bytes32'], [peerId3]))),
        ];

        // Report Peer 3
        await consensus.reportPeer(signatures3, validators, peerId3);

        const validatorRewardOwner3 = await consensus.validatorRewards(ownerAddress);
        const validatorRewardSecond3 = await consensus.validatorRewards(secondAddress);
        expect(validatorRewardOwner3).to.be.gt(validatorRewardOwner1);
        expect(validatorRewardSecond3).to.be.gt(validatorRewardSecond1);

        const peer1Rewards = await consensus.rewards(peerId1);
        const peer3Rewards = await consensus.rewards(peerId3);
        expect(peer1Rewards).to.be.gt(0);
        expect(peer3Rewards).to.be.gt(0);

        // Claim rewards
        const mintPayload = rewardToken.interface.encodeFunctionData('mint', [ownerAddress, wei(100)]);
        const estimatedFees = await lZEndpointMockReceiver.estimateFees(
            receiverChainId,
            await rewardToken.getAddress(),
            mintPayload,
            false,
            '0x'
        );

        await consensus.claim(peerId1, {value: estimatedFees[0]});
        await consensus.claim(peerId3, {value: estimatedFees[0]});
        await consensus.claim(ethers.encodeBytes32String(""), {value: estimatedFees[0]});

        // Check final balances
        const finalBalanceOwner = await rewardToken.balanceOf(ownerAddress);
        const finalBalanceSecond = await rewardToken.balanceOf(secondAddress);

        expect(finalBalanceOwner).to.be.gt(0);
        expect(finalBalanceSecond).to.be.gt(0);

        const finalPeer1Balance = await consensus.rewards(peerId1);
        const finalPeer3Balance = await consensus.rewards(peerId3);

        expect(finalPeer1Balance).to.equal(0);
        expect(finalPeer3Balance).to.equal(0);
    });
  });

  describe('Consensus Integration Tests for Joining at Different Times', function () {
    it('should handle peers joining at different times and calculate rewards correctly', async () => {
        const peerId1 = generatePeerID();
        const peerId2 = generatePeerID();
        const peerId3 = generatePeerID();

        // Peer 1 joins
        await consensus.connect(SECOND).registerPeer(peerId1, 250);
        expect(await consensus.totalContributions()).to.equal(250);

        // Advance time by 10 days
        const startTime = Number((await consensus.rewardStart()).toString());
        await setTime(startTime + oneDay * 2);

        // Peer 2 joins
        await consensus.connect(SECOND).registerPeer(peerId2, 300);
        expect(await consensus.totalContributions()).to.equal(550);

        // Advance time by 30 days (total 40 days)
        await setTime(startTime + oneDay * 3);

        // Peer 3 joins
        await consensus.connect(SECOND).registerPeer(peerId3, 200);
        expect(await consensus.totalContributions()).to.equal(750);

        // Advance time by 50 more days (total 90 days, end of initial period)
        await setTime(startTime + oneDay * 90);

        const initialDailyReward = await rewardToken.cap() * BigInt(20) / BigInt(100) / BigInt(90);

        // Verify rewards for each peer
        const peer1Rewards = await consensus.earned(peerId1);
        const peer2Rewards = await consensus.earned(peerId2);
        const peer3Rewards = await consensus.earned(peerId3);

        // Calculated expected rewards
        const initialPeriodRewards = initialDailyReward * BigInt(90);

        expect(peer1Rewards + peer2Rewards + peer3Rewards).to.be.closeTo(initialPeriodRewards, 10); // Allow small margin for rounding errors
    });

    it('should handle peers joining and deactivating across halving periods', async () => {
        const peerId1 = generatePeerID();
        const peerId2 = generatePeerID();
        const peerId3 = generatePeerID();

        await consensus.setValidator(ownerAddress, true);

        // Peer 1 joins
        await consensus.connect(SECOND).registerPeer(peerId1, 250);
        expect(await consensus.totalContributions()).to.equal(250);

        // Advance time to end of initial period (90 days)
        const startTime = Number((await consensus.rewardStart()).toString());
        await setTime(startTime + oneDay * 90 - 1);

        
        // Peer 2 joins
        await consensus.connect(SECOND).registerPeer(peerId2, 250);
        const peer1RewardsInitial = await consensus.earned(peerId1);

        expect(await consensus.totalContributions()).to.equal(500);

        
        // Advance time by 1 year (365 days total)
        await setTime(startTime + oneDay * 365);

        const peer1RewardsAfterYear1 = await consensus.earned(peerId1) - peer1RewardsInitial;
        const peer2RewardsAfterYear1 = await consensus.earned(peerId2);

        expect(BigInt(fromWei(peer1RewardsAfterYear1))).to.be.closeTo(BigInt(fromWei(peer2RewardsAfterYear1)), 10);

        // Peer 3 joins
        await consensus.connect(SECOND).registerPeer(peerId3, 200);
        expect(await consensus.totalContributions()).to.equal(700);

        // Advance time by another year (730 days total)
        await setTime(startTime + oneDay * 365 * 2);

        // Verify rewards for each peer
        const peer1Rewards = await consensus.earned(peerId1);
        const peer2Rewards = await consensus.earned(peerId2);
        const peer3Rewards = await consensus.earned(peerId3);

        const rewards = await lib.calculateAccumulatedDistribution(await rewardToken.cap(), await consensus.rewardStart(), await consensus.rewardStart(), await getCurrentBlockTime());

        // Calculated expected rewards
        const initialDailyReward = await rewardToken.cap() * BigInt(20) / BigInt(100) / BigInt(90);
        const halvedDailyReward = initialDailyReward / BigInt(2); // Rewards are halved after initial period
        const halvedDailyReward2 = halvedDailyReward / BigInt(2); // Rewards are halved again after 1 year

        const totalRewards = initialDailyReward * BigInt(90) + halvedDailyReward * BigInt(365 - 90) + halvedDailyReward2 * BigInt(365);

        expect(rewards).to.be.closeTo(totalRewards, 10);

        expect(peer1Rewards + peer2Rewards + peer3Rewards).to.be.closeTo(totalRewards, 10); // Allow small margin for rounding errors
    });

    it('should handle peers joining and deactivating between halving periods', async () => {
        const peerId1 = generatePeerID();
        const peerId2 = generatePeerID();

        await consensus.setValidator(ownerAddress, true);

        const startTime = Number((await consensus.rewardStart()).toString());

        await setTime(startTime - 1);

        // Peer 1 joins
        await consensus.connect(SECOND).registerPeer(peerId1, 250);
        expect(await consensus.totalContributions()).to.equal(250);

        // Advance time to end of initial period (90 days)
        await setTime(startTime + oneDay * 90);

        // Peer 2 joins
        await consensus.connect(SECOND).registerPeer(peerId2, 300);
        expect(await consensus.totalContributions()).to.equal(550);

        // Advance time by 6 months (180 days total)
        await setTime(startTime + oneDay * 180);
        // Peer 2 deactivates
        await consensus.connect(SECOND).deactivatePeer(peerId2);

        expect(await consensus.totalContributions()).to.equal(250);

        // Advance time by another 6 months (365 days total)
        await setTime(startTime + oneDay * 365);

        // Verify rewards for each peer
        const peer1Rewards = await consensus.earned(peerId1);
        const peer2Rewards = await consensus.earned(peerId2);

        // Calculated expected rewards
        const initialDailyReward = await rewardToken.cap() * BigInt(20) / BigInt(100) / BigInt(90);
        const halvedDailyReward = initialDailyReward / BigInt(2); // Rewards are halved after initial period

        const expectedRewards = initialDailyReward * BigInt(90) + halvedDailyReward * BigInt(275);

        expect(peer1Rewards + peer2Rewards).to.be.closeTo(expectedRewards, 10); // Allow small margin for rounding errors
    });
 });



  describe('removeUpgradeability', () => {
    it('should prevent future upgrades', async () => {
      await consensus.removeUpgradeability();
      await expect(consensus.upgradeToAndCall(ZERO_ADDR, '0x')).to.be.revertedWithoutReason();
    });
  });

  describe('_authorizeUpgrade', () => {
    it('should allow owner to upgrade', async () => {
      const consensusV2Factory = await ethers.getContractFactory('ConsensusV2');
      const consensusV2Implementation = await consensusV2Factory.deploy();

      await consensus.upgradeToAndCall(consensusV2Implementation.getAddress(), '0x');

      const consensusV2 = consensusV2Factory.attach(await consensus.getAddress()) as ConsensusV2;

      expect(await consensusV2.version()).to.equal(2);
    });

    it('should revert if non-owner attempts upgrade', async () => {
      const consensusV2Factory = await ethers.getContractFactory('ConsensusV2');
      const consensusV2Implementation = await consensusV2Factory.deploy();

      await expect(consensus.connect(SECOND).upgradeToAndCall(consensusV2Implementation.getAddress(), '0x'))
        .to.be.revertedWithCustomError(consensus, 'OwnableUnauthorizedAccount');
    });
  });
});
