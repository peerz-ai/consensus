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
import { wei } from '@/scripts/utils/utils';
import { getCurrentBlockTime, setNextTime } from '@/test/helpers/block-helper';
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
    rewardToken = await PRZFactory.deploy(wei(1000000000));

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
      const hashedPeerId = await consensus.generatePeerId(peerId);
      await consensus.registerPeer(hashedPeerId, secondAddress);
      expect(await consensus.peers(hashedPeerId)).to.equal(secondAddress);
    });
  });

  describe('validateNetworkState', () => {
    it('should validate network state and update balances', async () => {
      const peerId = generatePeerID();
      const hashedPeerId = await consensus.generatePeerId(peerId);

      const peerIds = [hashedPeerId];
      const throughputs = [100];
      const layers = [2];
      const total = 200;
      const validators = [ownerAddress];


      const signatures = [await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
        ['bytes32[]', 'uint256[]', 'uint256[]', 'uint256'], [peerIds, throughputs, layers, total]
      )))];

      await consensus.setValidator(ownerAddress, true);
      await consensus.registerPeer(peerIds[0], secondAddress);

      const lastUpdate = await getCurrentBlockTime();
      await setNextTime(lastUpdate + oneDay);

      await consensus.validateNetworkState(peerIds, throughputs, layers, total, signatures, validators);
      expect(await consensus.peerBalances(secondAddress)).to.be.gt(0);
    });

    it('should revert if data length mismatch', async () => {
      const peerId = generatePeerID();
      const hashedPeerId = await consensus.generatePeerId(peerId);

      const peerIds = [hashedPeerId];
      const throughputs = [100];
      const layers = [2, 3];
      const total = 200;
      const validators = [ownerAddress];

      const signatures = [await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
        ['bytes32[]', 'uint256[]', 'uint256[]', 'uint256'], [peerIds, throughputs, layers, total]
      )))];

      await expect(consensus.validateNetworkState(peerIds, throughputs, layers, total, signatures, validators))
        .to.be.revertedWith('Data length mismatch');
    });

    it('should revert if signature count mismatch', async () => {
      const peerId = generatePeerID();
      const hashedPeerId = await consensus.generatePeerId(peerId);
      const peerIds = [hashedPeerId];
      const throughputs = [100];
      const layers = [2];
      const total = 200;
      const validators = [ownerAddress];
      const signatures: any = [];

      await expect(consensus.validateNetworkState(peerIds, throughputs, layers, total, signatures, validators))
        .to.be.revertedWith('Signature count mismatch');
    });

    it('should revert if no validators', async () => {
      const peerId = generatePeerID();
      const hashedPeerId = await consensus.generatePeerId(peerId);
      const peerIds = [hashedPeerId];
      const throughputs = [100];
      const layers = [2];
      const total = 200;
      const validators = [ownerAddress];
      const signatures = [await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
        ['bytes32[]', 'uint256[]', 'uint256[]', 'uint256'], [peerIds, throughputs, layers, total]
      )))];

      await expect(consensus.validateNetworkState(peerIds, throughputs, layers, total, signatures, validators))
        .to.be.revertedWith('No validators');
    });

    it('should revert if consensus is not reached', async () => {
      const peerId = generatePeerID();
      const hashedPeerId = await consensus.generatePeerId(peerId);
      const peerIds = [hashedPeerId];
      const throughputs1 = [100];
      const throughputs2 = [200];
      const layers = [2];
      const total = 200;
      const validators = [ownerAddress, secondAddress];
      const signatures = [
        await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
          ['bytes32[]', 'uint256[]', 'uint256[]', 'uint256'], [peerIds, throughputs1, layers, total]
        ))),
        await SECOND.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
          ['bytes32[]', 'uint256[]', 'uint256[]', 'uint256'], [peerIds, throughputs2, layers, total]
        )))
      ];

      await consensus.setValidator(ownerAddress, true);
      await consensus.setValidator(secondAddress, true);

      await expect(consensus.validateNetworkState(peerIds, throughputs1, layers, total, signatures, validators))
        .to.be.revertedWith('Consensus not reached');
    });
  });

  describe('claim', () => {
    it('should allow user to claim rewards', async () => {
      const peerId = generatePeerID();
      const hashedPeerId = await consensus.generatePeerId(peerId);
      const peerIds = [hashedPeerId];
      const throughputs = [100];
      const layers = [2];
      const total = 200;
      const validators = [ownerAddress];
      const signatures = [await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(
        ['bytes32[]', 'uint256[]', 'uint256[]', 'uint256'], [peerIds, throughputs, layers, total]
      )))];

      await consensus.setValidator(ownerAddress, true);
      await consensus.registerPeer(peerIds[0], ownerAddress);

      const lastUpdate = await getCurrentBlockTime();
      await setNextTime(lastUpdate + oneDay);

      await consensus.validateNetworkState(peerIds, throughputs, layers, total, signatures, validators);

      const initialBalance = await rewardToken.balanceOf(ownerAddress);

      const mintPayload = rewardToken.interface.encodeFunctionData('mint', [ownerAddress, wei(100)]);

      const estimatedFees = await lZEndpointMockReceiver.estimateFees(
        receiverChainId,
        await rewardToken.getAddress(),
        mintPayload,
        false,
        '0x'
      );

      await consensus.claim(ownerAddress, {value: estimatedFees[0]});

      const finalBalance = await rewardToken.balanceOf(ownerAddress);

      expect(finalBalance).to.be.gt(initialBalance);
    });

    it('should revert if rewards not started yet', async () => {
      await expect(consensus.claim(ownerAddress)).to.be.revertedWith('CNS: rewards not started yet');
    });

    it('should revert if nothing to claim', async () => {
      await setNextTime((await getCurrentBlockTime()) + oneDay);
      await expect(consensus.claim(ownerAddress)).to.be.revertedWith('CNS: nothing to claim');
    });
  });

  it('Should set the correct network state', async function () {
    const peerId = await consensus.generatePeerId('12D3KooW9tkZQ9721rCog7YScXCES9tFr8m7ViAKKFTRWfH6k5cj');

    const signers = await ethers.getSigners();
    // first half are validators and the rest are peers
    const validatorsSigners = signers.slice(0, signers.length / 2);
    const peersSigners = signers.slice(signers.length / 2);

    console.log('signers', validatorsSigners.length, peersSigners.length);

    const peers = await getDefaultNetworkState(peersSigners.length);

    const peerIds = await Promise.all(peers.map((x) => consensus.generatePeerId(x.peerId))); // peerId
    const throughputs = peers.map((x) => x.throughput); // throughput
    const layers = peers.map((x) => x.layers); // layers
    const total = peers.reduce((acc, x) => acc + x.throughput * x.layers, 0); // total throughput

    const message = ethers.solidityPackedKeccak256(
      ['bytes32[]', 'uint256[]', 'uint256[]', 'uint256'],
      [peerIds, throughputs, layers, total],
    );

    const signatures = await Promise.all(
      validatorsSigners.map(async (signer) => {
        return await signer.signMessage(ethers.toBeArray(message));
      }),
    );

    const tx = await consensus.testSignature(
      peerIds,
      throughputs,
      layers,
      total,
      signatures[7],
      validatorsSigners[7],
    );

    console.log(tx, await validatorsSigners[7].getAddress());

    await Promise.all(
      peerIds.map(async (peerId, index) => {
        await consensus.registerPeer(peerId, peersSigners[index]);
      }),
    );

    await Promise.all(
      validatorsSigners.map(async (validator, index) => {
        await consensus.setValidator(validator, true);
      }),
    );

    const timestamp = await getCurrentBlockTime();

    await setNextTime(timestamp + 60);

    const a = await consensus.validateNetworkState(
      peerIds,
      throughputs,
      layers,
      total,
      signatures,
      validatorsSigners,
    );

    const balance = await consensus.validatorBalances(SECOND);

    console.log(balance.toString());
  });

  describe('removeUpgradeability', () => {
    it('should prevent future upgrades', async () => {
      await consensus.removeUpgradeability();
      await expect(consensus.upgradeToAndCall(ZERO_ADDR, '0x')).to.be.revertedWith("CNS: upgrade isn't available");
    });
  });

  describe('_authorizeUpgrade', () => {
    it('should allow owner to upgrade', async () => {
      const consensusV2Factory = await ethers.getContractFactory('ConsensusV2', {
        libraries: {
          Distribution: await lib.getAddress(),
        },
      });
      const consensusV2Implementation = await consensusV2Factory.deploy();

      await consensus.upgradeToAndCall(consensusV2Implementation.getAddress(), '0x');

      const consensusV2 = consensusV2Factory.attach(await consensus.getAddress()) as ConsensusV2;

      expect(await consensusV2.version()).to.equal(2);
    });

    it('should revert if non-owner attempts upgrade', async () => {
      const consensusV2Factory = await ethers.getContractFactory('ConsensusV2', {
        libraries: {
          Distribution: await lib.getAddress(),
        },
      });
      const consensusV2Implementation = await consensusV2Factory.deploy();

      await expect(consensus.connect(SECOND).upgradeToAndCall(consensusV2Implementation.getAddress(), '0x'))
        .to.be.revertedWithCustomError(consensus, 'OwnableUnauthorizedAccount');
    });
  });
});
