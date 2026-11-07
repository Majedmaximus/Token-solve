import {networkOptions,TRON_USDT,describeNetwork} from './networks.mjs';
import {mountTrustbook} from './trustbook-ui.mjs';
import {createIdentity,exportPublicKey,fingerprint,signRequest,verifyRequest,signRevocation} from './requests.mjs';
const $=id=>document.getElementById(id);let identity,lastSigned,creationRevision=0;
for(const [id,name,symbol] of networkOptions){const option=document.createElement('option');option.value=id;option.textContent=`${name} · ${symbol}`;$('network').append(option);}
const customNetwork=document.createElement('option');customNetwork.value='custom';customNetwork.textContent='Other EVM chain ID';$('network').append(customNetwork);
function updateNetwork(){
 const chain=$('chain').value.trim(),tron=chain.startsWith('tron:'),solana=chain.startsWith('solana:');
 $('recipient-label').textContent=tron?'Recipient TRON address':solana?'Recipient Solana address':'Recipient EVM address';
 $('recipient').placeholder=tron?'T… (Base58Check)':solana?'Solana Base58 address':'0x…';
 $('network-help').textContent=tron?'TRON addresses are checked with Base58Check. Mainnet USDT uses 6 decimal places. TRC20 transfers may require TRX or energy; this tool does not pay or execute them.':solana?'Solana addresses use Base58 and have no checksum. SPL tokens use their mint address. Verify the destination independently.':'EVM instructions use 0x addresses. Check the network and token contract independently.';
 const usdt=$('asset-preset').querySelector('[value="usdt-tron"]');usdt.disabled=chain!=='tron:mainnet';
 if(usdt.disabled&&$('asset-preset').value==='usdt-tron'){$('asset-preset').value='native';$('asset').value='native';}
}
$('network').onchange=()=>{
 const id=$('network').value;$('chain').readOnly=id!=='custom';$('chain').value=id==='custom'?'':id;
 $('recipient').value='';$('asset-preset').value=id==='tron:mainnet'?'usdt-tron':'native';
 $('asset').value=id==='tron:mainnet'?TRON_USDT:'native';$('asset').readOnly=true;updateNetwork();
};
$('chain').addEventListener('input',updateNetwork);
$('asset-preset').onchange=()=>{const type=$('asset-preset').value;$('asset').readOnly=type!=='custom';$('asset').value=type==='usdt-tron'?TRON_USDT:type==='native'?'native':'';};
$('chain').readOnly=true;$('asset').readOnly=true;updateNetwork();
$('identity').onclick=async()=>{creationRevision++;try{if(!crypto.subtle)throw Error('Use HTTPS or a localhost server for Web Crypto.');identity=await createIdentity();const f=await fingerprint(await exportPublicKey(identity.publicKey));$('fingerprint').replaceChildren();const code=document.createElement('code');code.textContent=f;$('fingerprint').append(code);$('sign').disabled=false;$('signed').value='';$('download-request').disabled=true;lastSigned=undefined;$('create-status').textContent='Temporary identity ready. Share its fingerprint through a separately trusted channel.';}catch(e){$('create-status').textContent=e.message;}};
$('create').onsubmit=async e=>{e.preventDefault();const version=++creationRevision;$('signed').value='';$('download-request').disabled=true;$('sign').disabled=true;try{if(!identity)throw Error('Generate an identity first.');const f=e.currentTarget.elements;const r=await signRequest(identity,{chainId:f.chain.value.trim(),asset:f.asset.value.trim(),amount:f.amount.value.trim(),recipient:f.recipient.value.trim(),purpose:f.purpose.value.trim()});if(version!==creationRevision)return;lastSigned=r;$('signed').value=JSON.stringify(r,null,2);$('download-request').disabled=false;$('create-status').textContent='Request signed. No payment was made.';}catch(err){if(version===creationRevision)$('create-status').textContent=err.message;}finally{$('sign').disabled=!identity;}};
let revision=0,expiryTimer,verifiedExpiry;
function invalidate(message='Input changed. Verify again.'){
 revision++;clearTimeout(expiryTimer);verifiedExpiry=undefined;
 $('result').textContent=message;$('details').textContent='';
}
function expireIfNeeded(){if(verifiedExpiry!==undefined&&Date.now()>=verifiedExpiry)invalidate('Request expired. No current verified result.');}
$('verify').onclick=async()=>{
 const version=++revision;clearTimeout(expiryTimer);verifiedExpiry=undefined;
 $('verify').disabled=true;$('details').textContent='';$('result').textContent='Checking…';
 try{
  const text=$('envelope').value,expected=$('expected').value.trim();
  if(text.length>12000)throw Error('Request too large.');
  const r=await verifyRequest(JSON.parse(text),expected);
  if(version!==revision)return;
  // Recheck at display time; asynchronous crypto must not outlive the validity window.
  const current=r.inTime&&Date.now()<r.payload.expiresAt;
  if(r.signatureValid&&r.trusted&&current){
   $('result').textContent='Signature matches the expected key and the validity window. Registry status not checked here. This is not proof of personal identity, available funds or payment safety.';
   $('details').textContent=`SIGNED DETAILS\nNetwork / asset: ${describeNetwork(r.payload.chainId,r.payload.asset)}\nNetwork ID: ${r.payload.chainId}\nAsset: ${r.payload.asset}\nAmount: ${r.payload.amount}\nRecipient: ${r.payload.recipient}\nPurpose: ${r.payload.purpose}\nRequest ID: ${r.payload.id}\nExpires: ${new Date(r.payload.expiresAt).toISOString()}\nNo payment has been executed.`;
   verifiedExpiry=r.payload.expiresAt;expiryTimer=setTimeout(expireIfNeeded,Math.max(0,verifiedExpiry-Date.now()));
  }else $('result').textContent=`Not verified.\nSignature: ${r.signatureValid?'valid':'INVALID — content or signature mismatch'}\nExpected key: ${r.trusted?'matches':'NOT MATCHED'}\nTime window: ${current?'current':'EXPIRED OR NOT YET VALID'}`;
 }catch{if(version===revision)$('result').textContent='Not verified. Invalid JSON, unsupported request format, key or signature.';}
 finally{$('verify').disabled=false;}
};
mountTrustbook(document.getElementById('trustbook'),$('expected'),()=>invalidate(''));
for(const id of ['envelope','expected'])$(id).addEventListener('input',()=>invalidate());
window.addEventListener('focus',expireIfNeeded);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)expireIfNeeded();});

$('create').addEventListener('input',()=>{creationRevision++;lastSigned=undefined;$('signed').value='';$('download-request').disabled=true;$('create-status').textContent='Instructions changed. Sign a new request before sharing.';});
$('create').addEventListener('change',()=>{creationRevision++;lastSigned=undefined;$('signed').value='';$('download-request').disabled=true;});
$('download-request').onclick=()=>{
 if(!$('signed').value)return;
 const url=URL.createObjectURL(new Blob([$('signed').value],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='TRACE-signed-request.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('import-request').onchange=async()=>{
 invalidate('Loading request file…');const version=revision;
 $('envelope').value='';const file=$('import-request').files?.[0];
 try{
  if(!file)throw Error('No request file selected.');
  if(file.size>12000)throw Error('Request file exceeds 12 KB.');
  const text=await file.text();
  if(version!==revision)return;
  if(text.length>12000)throw Error('Request file too large.');
  const parsed=JSON.parse(text);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Expected a signed request JSON object.');
  $('envelope').value=text;
  invalidate('Request imported. Check the signature against your independently trusted fingerprint.');
 }catch(e){if(version===revision)invalidate('Import rejected: '+e.message);}
 finally{$('import-request').value='';}
};

