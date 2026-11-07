// Local address checks only: no RPC, balance check or transfer execution.
// Contract/decimals checked against trustwallet/assets commit 2ca12287a42c7f419c89446b0e3257cfcb636004, blockchains/tron/assets/<address>/info.json.
export const TRON_USDT='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const networkOptions=[
 ['1','Ethereum','ETH'],['8453','Base','ETH'],['137','Polygon','POL'],['56','BNB Smart Chain','BNB'],
 ['42161','Arbitrum One','ETH'],['10','Optimism','ETH'],['43114','Avalanche C-Chain','AVAX'],
 ['tron:mainnet','TRON Mainnet','TRX'],['tron:shasta','TRON Shasta Testnet','test TRX'],
 ['solana:mainnet','Solana Mainnet','SOL'],['solana:devnet','Solana Devnet','test SOL']
];
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeBase58(text){
 if(typeof text!=='string'||text.length<1||text.length>50)throw Error('Invalid Base58 address.');
 let n=0n;for(const char of text){const digit=alphabet.indexOf(char);if(digit<0)throw Error('Invalid Base58 address.');n=n*58n+BigInt(digit);}
 const bytes=[];while(n>0n){bytes.unshift(Number(n&255n));n>>=8n;}
 for(let i=0;i<text.length&&text[i]==='1';i++)bytes.unshift(0);
 return Uint8Array.from(bytes);
}
export async function validateTronAddress(text){
 if(typeof text!=='string'||!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(text))throw Error('Enter a TRON Base58Check address starting with T.');
 const bytes=decodeBase58(text);
 if(bytes.length!==25||bytes[0]!==0x41)throw Error('Invalid TRON address prefix or length.');
 const first=await crypto.subtle.digest('SHA-256',bytes.slice(0,21));
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',first));
 if(!bytes.slice(21).every((v,i)=>v===hash[i]))throw Error('TRON address checksum does not match.');
 if(bytes.slice(1,21).every(v=>v===0))throw Error('Zero TRON address is not permitted.');
}
export function validateSolanaAddress(text){
 const bytes=decodeBase58(text);
 if(bytes.length!==32||bytes.every(v=>v===0))throw Error('Enter a nonzero 32-byte Solana Base58 address.');
 // Solana addresses do not have a checksum; a valid shape does not prove ownership.
}
export async function validateNetworkFields(p){
 const known=networkOptions.find(([id])=>id===p.chainId);
 if(!known||!p.chainId.includes(':'))throw Error('Unsupported network identifier.');
 if(typeof p.asset!=='string'||typeof p.recipient!=='string')throw Error('Invalid network address fields.');
 if(p.chainId.startsWith('tron:')){
  await validateTronAddress(p.recipient);if(p.asset!=='native')await validateTronAddress(p.asset);
  if(p.chainId==='tron:shasta'&&p.asset===TRON_USDT)throw Error('Mainnet USDT preset cannot be used on Shasta.');
 }else{
  validateSolanaAddress(p.recipient);if(p.asset!=='native')validateSolanaAddress(p.asset);
 }
 const precision=p.asset==='native'?(p.chainId.startsWith('tron:')?6:9):p.chainId==='tron:mainnet'&&p.asset===TRON_USDT?6:18;
 if((p.amount.split('.')[1]||'').length>precision)throw Error(`This asset permits at most ${precision} decimal places.`);
}
export function describeNetwork(chainId,asset){
 const network=networkOptions.find(([id])=>id===chainId);
 const name=network?.[1]||`EVM chain ${chainId}`;
 const symbol=asset==='native'?(network?.[2]||'native asset'):chainId==='tron:mainnet'&&asset===TRON_USDT?'USDT · TRC20':chainId.startsWith('tron:')?'TRC20 contract':chainId.startsWith('solana:')?'SPL mint':'EVM token contract';
 return `${name} / ${symbol}`;
}
