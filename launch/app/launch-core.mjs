import {BrowserProvider,Contract,ContractFactory,getAddress,ZeroAddress,parseUnits,formatEther,keccak256} from '../vendor/ethers.min.js';
export {BrowserProvider,getAddress};
export const TEST_CHAINS={84532:'Base Sepolia',11155111:'Ethereum Sepolia'};
async function chain(provider){const id=Number(BigInt(await provider.send('eth_chainId',[])));if(!TEST_CHAINS[id])throw Error('Transaction blocked: only Base Sepolia or Ethereum Sepolia is enabled. Mainnet requires an approved funding plan.');return id;}
function address(value){const result=getAddress(value);if(result===ZeroAddress)throw Error('Zero address is not allowed.');return result;}
function amount(value){if(typeof value!=='string'||!/^[1-9][0-9]{0,59}$/.test(value))throw Error('Supply must be a positive whole-token integer.');const result=parseUnits(value,18);if(result>=2n**256n)throw Error('Supply exceeds uint256.');return result;}
function metadata(input){if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>48||/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/u.test(input.name))throw Error('Invalid token name.');if(typeof input.symbol!=='string'||!/^[A-Z][A-Z0-9]{0,11}$/.test(input.symbol))throw Error('Use a symbol of 1–12 uppercase letters/digits.');return {name:input.name.trim(),symbol:input.symbol,supply:amount(input.wholeSupply),recipient:address(input.recipient)};}
async function review(provider,signer,artifact,args){
 const chainId=await chain(provider),deployer=address(await signer.getAddress()),factory=new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer);
 const tx=await factory.getDeployTransaction(...args);const gas=await signer.estimateGas(tx),fees=await provider.getFeeData();const perGas=fees.maxFeePerGas??fees.gasPrice;
 if(perGas===null)throw Error('Wallet RPC did not return a fee estimate.');const gasLimit=gas*120n/100n;const maxFee=gasLimit*perGas;
 if(await provider.getBalance(deployer)<maxFee)throw Error('Insufficient test-network ETH for the estimated deployment fee. No transaction sent.');
 const feeFields=fees.maxFeePerGas!==null&&fees.maxPriorityFeePerGas!==null?{maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas}:{gasPrice:perGas};
 return {chainId,deployer,args,tx:{data:tx.data,value:0n,gasLimit,...feeFields},dataHash:keccak256(tx.data),maxEstimatedFeeWei:maxFee.toString(),maxEstimatedFeeETH:formatEther(maxFee)};
}
export async function prepareToken(provider,signer,artifact,input){const meta=metadata(input);return {...await review(provider,signer,artifact,[meta.name,meta.symbol,meta.recipient,meta.supply]),kind:'token',meta:{...meta,supply:meta.supply.toString(),wholeSupply:input.wholeSupply}};}
export async function prepareVesting(provider,signer,artifact,input,now=Math.floor(Date.now()/1000)){
 const beneficiary=address(input.beneficiary),start=Number(input.start),duration=Number(input.duration);
 if(!Number.isSafeInteger(start)||start<now+600)throw Error('Lock start must be at least 10 minutes in the future.');
 if(!Number.isSafeInteger(duration)||duration<0||duration>10*366*86400)throw Error('Duration must be 0–10 years in seconds.');
 return {...await review(provider,signer,artifact,[beneficiary,start,duration]),kind:'vesting',meta:{beneficiary,start,duration}};
}
function normalizedRuntime(code,references){let result=code.replace(/^0x/,'').toLowerCase();for(const entries of Object.values(references||{}))for(const {start,length} of entries)result=result.slice(0,start*2)+'0'.repeat(length*2)+result.slice((start+length)*2);return result;}
export async function deployReviewed(provider,signer,artifact,plan,onSubmitted=()=>{}){
 const current=await chain(provider);if(current!==plan.chainId||address(await signer.getAddress())!==plan.deployer)throw Error('Wallet account/network changed; review again.');
 const expected=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).getDeployTransaction(...plan.args);
 if(keccak256(expected.data)!==plan.dataHash||keccak256(plan.tx.data)!==plan.dataHash||plan.tx.value!==0n)throw Error('Reviewed deployment data changed.');
 const feeCap=plan.tx.maxFeePerGas??plan.tx.gasPrice;if(!feeCap||plan.tx.gasLimit*feeCap>BigInt(plan.maxEstimatedFeeWei))throw Error('Reviewed fee cap changed.');
 const tx=await signer.sendTransaction({...plan.tx,chainId:BigInt(current)});await onSubmitted({chainId:plan.chainId,deployer:plan.deployer,transactionHash:tx.hash,status:'submitted-unconfirmed',kind:plan.kind,configuration:plan.meta});
 const receipt=await tx.wait(1);if(!receipt||receipt.status!==1||!receipt.contractAddress)throw Error('Deployment not confirmed successfully. Retain the submitted transaction hash.');
 return checkDeployment(provider,artifact,plan,receipt);
}
async function checkDeployment(provider,artifact,plan,receipt){
 const current=await chain(provider);if(current!==plan.chainId)throw Error('Switch back to the receipt network before checking it.');
 const contractAddress=address(receipt.contractAddress),code=await provider.getCode(contractAddress);
 if(normalizedRuntime(code,artifact.evm.deployedBytecode.immutableReferences)!==normalizedRuntime(artifact.evm.deployedBytecode.object,artifact.evm.deployedBytecode.immutableReferences))throw Error('Deployed code differs from the reviewed build. Retain the transaction hash for investigation.');
 const contract=new Contract(contractAddress,artifact.abi,provider);
 if(plan.kind==='token'){
  if(await contract.name()!==plan.meta.name||await contract.symbol()!==plan.meta.symbol||await contract.totalSupply()!==BigInt(plan.meta.supply))throw Error('On-chain token metadata/supply mismatch.');
  const mint=receipt.logs.map(log=>{try{return contract.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='Transfer'&&log.args.from===ZeroAddress&&address(log.args.to)===plan.meta.recipient&&log.args.value===BigInt(plan.meta.supply));
  if(!mint)throw Error('Initial recipient/supply was not confirmed in the mint receipt.');
 }else{
  const ownership=receipt.logs.map(log=>{try{return contract.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='OwnershipTransferred'&&log.args.previousOwner===ZeroAddress&&address(log.args.newOwner)===plan.meta.beneficiary);
  if(!ownership||await contract.start()!==BigInt(plan.meta.start)||await contract.duration()!==BigInt(plan.meta.duration))throw Error('On-chain vesting configuration mismatch.');
 }
 return {status:'confirmed-by-connected-RPC',networkKind:'testnet',chainId:current,network:TEST_CHAINS[current],kind:plan.kind,contractAddress,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,deployer:plan.deployer,configuration:plan.meta,runtimeCodeHash:keccak256(code),funding:plan.kind==='vesting'?'creation-only; funding requires a separate transfer receipt':'initial supply minted to configured recipient',observedAt:new Date().toISOString()};
}
export async function fundVesting(provider,signer,tokenArtifact,vestingArtifact,input,onSubmitted=()=>{}){
 const chainId=await chain(provider),sender=address(await signer.getAddress()),tokenAddress=address(input.token),vestingAddress=address(input.vesting),units=amount(input.wholeAmount);
 if(tokenAddress===vestingAddress)throw Error('Token and vesting address must differ.');
 const tokenCode=await provider.getCode(tokenAddress);
 if(normalizedRuntime(tokenCode,tokenArtifact.evm.deployedBytecode.immutableReferences)!==normalizedRuntime(tokenArtifact.evm.deployedBytecode.object,tokenArtifact.evm.deployedBytecode.immutableReferences))throw Error('Token is not the reviewed project build.');
 const token=new Contract(tokenAddress,tokenArtifact.abi,signer),vesting=new Contract(vestingAddress,vestingArtifact.abi,provider);
 const code=await provider.getCode(vestingAddress);
 if(normalizedRuntime(code,vestingArtifact.evm.deployedBytecode.immutableReferences)!==normalizedRuntime(vestingArtifact.evm.deployedBytecode.object,vestingArtifact.evm.deployedBytecode.immutableReferences))throw Error('Destination is not the reviewed vesting build.');
 const beneficiary=address(await vesting.owner()),start=await vesting.start(),duration=await vesting.duration();
 if(input.expectedStart!==undefined&&(BigInt(input.expectedStart)!==start||BigInt(input.expectedDuration)!==duration))throw Error('Lock schedule differs from the inspected schedule.');
 if(beneficiary!==address(input.expectedBeneficiary))throw Error('Vesting beneficiary does not match your reviewed address.');
 const block=await provider.getBlock('latest');if(BigInt(block.timestamp)>=start)throw Error('Funding blocked after vesting start: a late deposit could be immediately withdrawable.');
 if(await token.decimals()!==18n||await token.balanceOf(sender)<units)throw Error('Wrong token decimals or insufficient token balance.');
 if(await chain(provider)!==chainId)throw Error('Network changed.');
 const tx=await token.transfer(vestingAddress,units,{chainId:BigInt(chainId)});await onSubmitted({chainId,deployer:sender,transactionHash:tx.hash,status:'funding-submitted-unconfirmed',kind:'funding',tokenAddress,vestingAddress,beneficiary,wholeAmount:input.wholeAmount,baseUnits:units.toString()});const receipt=await tx.wait(1);
 if(!receipt||receipt.status!==1)throw Error('Funding not confirmed.');
 const transfer=receipt.logs.map(log=>{try{return token.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='Transfer'&&address(log.args.from)===sender&&address(log.args.to)===vestingAddress&&log.args.value===units);
 if(!transfer)throw Error('Funding transfer not found in receipt.');
 const confirmedBlock=await provider.getBlock(receipt.blockNumber);
 return {status:'funding-confirmed-by-connected-RPC',kind:'funding',deployer:sender,networkKind:'testnet',chainId,tokenAddress,vestingAddress,beneficiary,wholeAmount:input.wholeAmount,baseUnits:units.toString(),transactionHash:receipt.hash,blockNumber:receipt.blockNumber,vestingHadStartedAtConfirmation:BigInt(confirmedBlock.timestamp)>=start,notice:'Tokens follow the immutable schedule; beneficiary rights remain transferable. No yield generated.'};
}

export async function inspectVesting(provider,artifact,contractAddress){
 const chainId=await chain(provider),target=address(contractAddress),code=await provider.getCode(target);
 if(normalizedRuntime(code,artifact.evm.deployedBytecode.immutableReferences)!==normalizedRuntime(artifact.evm.deployedBytecode.object,artifact.evm.deployedBytecode.immutableReferences))throw Error('Not the reviewed vesting build.');
 const v=new Contract(target,artifact.abi,provider),start=Number(await v.start()),duration=Number(await v.duration());
 return {chainId,address:target,beneficiary:address(await v.owner()),start,duration,end:start+duration,startUTC:new Date(start*1000).toISOString(),endUTC:new Date((start+duration)*1000).toISOString(),rightsTransferable:true};
}

export async function recheckRecord(provider,tokenArtifact,vestingArtifact,record){
 const chainId=await chain(provider);if(chainId!==record.chainId)throw Error('Switch to the recorded network before recovery.');
 const receipt=await provider.getTransactionReceipt(record.transactionHash);
 if(!receipt)return {...record,notice:'Still unconfirmed or unavailable from this RPC. Do not submit a duplicate.'};
 const tx=await provider.getTransaction(record.transactionHash);
 if(!tx||Number(tx.chainId)!==chainId||address(tx.from)!==address(record.deployer)||tx.value!==0n)throw Error('Recorded transaction origin/value differs from the chain.');
 if(receipt.status!==1)return {...record,status:'failed-on-chain',blockNumber:receipt.blockNumber};
 if(record.kind==='funding'){
  if(!tx.to||address(tx.to)!==address(record.tokenAddress))throw Error('Funding token address differs.');
  const token=new Contract(record.tokenAddress,tokenArtifact.abi,provider),decoded=token.interface.parseTransaction({data:tx.data});
  if(decoded?.name!=='transfer'||address(decoded.args[0])!==address(record.vestingAddress)||decoded.args[1]!==BigInt(record.baseUnits))throw Error('Funding transaction arguments differ.');
  const actual=receipt.logs.map(log=>{if(address(log.address)!==address(record.tokenAddress))return null;try{return token.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='Transfer'&&address(log.args.from)===address(record.deployer)&&address(log.args.to)===address(record.vestingAddress)&&log.args.value===BigInt(record.baseUnits));
  if(!actual)throw Error('Funding transfer not confirmed in token logs.');
  return {...record,status:'funding-confirmed-by-connected-RPC',blockNumber:receipt.blockNumber,observedAt:new Date().toISOString(),notice:'Funding receipt rechecked. Current lock ownership and releases may have changed since this transaction.'};
 }
 const artifact=record.kind==='token'?tokenArtifact:record.kind==='vesting'?vestingArtifact:null;
 if(!artifact||tx.to!==null||!receipt.contractAddress)throw Error('Not a supported deployment receipt.');
 const meta=record.configuration;
 const args=record.kind==='token'?[meta.name,meta.symbol,meta.recipient,BigInt(meta.supply)]:[meta.beneficiary,meta.start,meta.duration];
 const expected=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object).getDeployTransaction(...args);
 if(tx.data.toLowerCase()!==expected.data.toLowerCase())throw Error('Deployment constructor data differs from saved configuration.');
 return checkDeployment(provider,artifact,{kind:record.kind,chainId,deployer:record.deployer,meta},receipt);
}
