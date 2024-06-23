import { Deployer, Reporter, UserStorage } from '@solarity/hardhat-migrate';
import { ethers } from "hardhat";
import { Consensus__factory, ERC1967Proxy__factory, L2Sender__factory } from '@/generated-types/ethers';
import { IL2Sender } from '@/generated-types/ethers/contracts/L2Sender';
import { ZERO_ADDR } from '@/scripts/utils/constants';
import { getCurrentBlockTime, setNextTime } from '@/test/helpers/block-helper';

const layerZero = '0x4e08B1F1AC79898569CfB999FB92B5495FB18A2B';
const receiverChainId = '10161'; // sepolia


export = async (deployer: Deployer) => {
  const [owner] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", owner.address);

  const consensusImpl = await deployer.deploy(Consensus__factory);
  const consensusProxy = await deployer.deploy(ERC1967Proxy__factory, [consensusImpl, '0x'],  {
    name: 'Consensus Proxy',
  });
  const consensus = Consensus__factory.connect(await consensusProxy.getAddress(), await deployer.getSigner());

  const rewardTokenConfig: IL2Sender.RewardTokenConfigStruct = {
    gateway: layerZero,
    receiver: UserStorage.get('L1MessageReceiver Proxy'),
    // receiver: '0xdbfbf5eC5d0Ab01e74d29a2AC89Ef629792159f7',
    receiverChainId: receiverChainId,
    zroPaymentAddress: ZERO_ADDR,
    adapterParams: '0x',
  };

  const l2SenderImpl = await deployer.deploy(L2Sender__factory);
  const l2SenderProxy = await deployer.deploy(ERC1967Proxy__factory, [l2SenderImpl, '0x'], {
    name: 'L2Sender Proxy',
  });
  UserStorage.set('L2Sender Proxy', await l2SenderProxy.getAddress());
  const l2Sender = L2Sender__factory.connect(await l2SenderProxy.getAddress(), await deployer.getSigner());
  await l2Sender.L2Sender__init(await consensus.getAddress(), rewardTokenConfig);

  await consensus.Consensus_init(l2Sender, await getCurrentBlockTime(), '1000000000000000000000000000');

  Reporter.reportContracts(
    ['Consensus', await consensus.getAddress()],
    ['L2Sender', await l2Sender.getAddress()],
  );
}
