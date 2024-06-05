import { Deployer, Reporter, UserStorage } from '@solarity/hardhat-migrate';
import { ethers } from "hardhat";
import { PRZ__factory, L1MessageReceiver__factory, ERC1967Proxy__factory } from '@/generated-types/ethers';

const layerZero = '0x6EDCE65403992e310A62460808c4b910D972f10f';
const cap = '1000000000000000000000000000';

export = async (deployer: Deployer) => {
  const [owner] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", owner.address);

  const PRZ = await deployer.deploy(PRZ__factory, [cap]);
  UserStorage.set('PRZ', await PRZ.getAddress());

  const l1MessageReceiverImpl = await deployer.deploy(L1MessageReceiver__factory);
  const l1MessageReceiverProxy = await deployer.deploy(ERC1967Proxy__factory, [l1MessageReceiverImpl, '0x'], {
    name: 'L1MessageReceiver Proxy',
  });
  UserStorage.set('L1MessageReceiver Proxy', await l1MessageReceiverProxy.getAddress());
  const l1MessageReceiver = L1MessageReceiver__factory.connect(
    await l1MessageReceiverProxy.getAddress(),
    await deployer.getSigner(),
  );
  await l1MessageReceiver.L1MessageReceiver__init();

  await PRZ.transferOwnership(l1MessageReceiver);

  Reporter.reportContracts(
    ['L1MessageReceiver', await l1MessageReceiver.getAddress()],
    ['PRZ', await PRZ.getAddress()],
  );
}
