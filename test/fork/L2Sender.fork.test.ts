import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';

import { Reverter } from '../helpers/reverter';

import { IL2Sender, L2Sender } from '@/generated-types/ethers';
import { ZERO_ADDR } from '@/scripts/utils/constants';
import { wei } from '@/scripts/utils/utils';

describe('L2Sender Fork', () => {
  const reverter = new Reverter();

  let OWNER: SignerWithAddress;
  let SECOND: SignerWithAddress;

  const lzEndpointAddress = '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675';

  const richAddress = '0xE53FFF67f9f384d20Ebea36F43b93DC49Ed22753';

  let l2Sender: L2Sender;

  before(async () => {
    await ethers.provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: 'https://rpc.ankr.com/eth',
        },
      },
    ]);

    OWNER = await ethers.getImpersonatedSigner(richAddress);
    [, SECOND] = await ethers.getSigners();

    const [ERC1967ProxyFactory, L2Sender] = await Promise.all([
      ethers.getContractFactory('ERC1967Proxy', OWNER),
      ethers.getContractFactory('L2Sender', OWNER),
    ]);

    const rewardTokenConfig: IL2Sender.RewardTokenConfigStruct = {
      gateway: lzEndpointAddress,
      receiver: SECOND,
      receiverChainId: 110,
      zroPaymentAddress: ZERO_ADDR,
      adapterParams: '0x',
    };

    const l2SenderImplementation = await L2Sender.deploy();
    const l2SenderProxy = await ERC1967ProxyFactory.deploy(l2SenderImplementation, '0x');
    l2Sender = L2Sender.attach(l2SenderProxy) as L2Sender;
    await l2Sender.L2Sender__init(OWNER, rewardTokenConfig);

    await reverter.snapshot();
  });

  beforeEach(async () => {
    await reverter.revert();
  });

  after(async () => {
    await ethers.provider.send('hardhat_reset', []);
  });

  describe('sendMintMessage', () => {
    it('should just sendMintMessage', async () => {
      await l2Sender.sendMintMessage(SECOND, wei(1), OWNER, {
        value: wei(1),
      });
    });
  });
});
