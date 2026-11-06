import {mountTrustbook} from './trustbook-ui.mjs';
import {createIdentity,exportPublicKey,fingerprint,signRequest,verifyRequest,signRevocation} from './requests.mjs';
const $=id=>document.getElementById(id);let identity,lastSigned;
$('identity').onclick=async()=>{try{if(!crypto.subtle)throw Error('Use HTTPS or a localhost server for Web Crypto.');identity=await createIdentity();const f=await fingerprint(await exportPublicKey(identity.publicKey));$('fingerprint').replaceChildren();const code=document.createElement('code');code.textContent=f;$('fingerprint').append(code);$('sign').disabled=false;$('signed').value='';lastSigned=undefined;$('create-status').textContent='Temporary identity ready. Share its fingerprint through a separately trusted channel.';}catch(e){$('create-status').textContent=e.message;}};
$('create').onsubmit=async e=>{e.preventDefault();$('signed').value='';$('sign').disabled=true;try{if(!identity)throw Error('Generate an identity first.');const f=e.currentTarget.elements;const r=await signRequest(identity,{chainId:f.chain.value.trim(),asset:f.asset.value.trim(),amount:f.amount.value.trim(),recipient:f.recipient.value.trim(),purpose:f.purpose.value.trim()});lastSigned=r;$('signed').value=JSON.stringify(r,null,2);$('create-status').textContent='Request signed. No payment was made.';}catch(err){$('create-status').textContent=err.message;}finally{$('sign').disabled=!identity;}};
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
   $('details').textContent=`SIGNED DETAILS\nChain ID: ${r.payload.chainId}\nAsset: ${r.payload.asset}\nAmount: ${r.payload.amount}\nRecipient: ${r.payload.recipient}\nPurpose: ${r.payload.purpose}\nRequest ID: ${r.payload.id}\nExpires: ${new Date(r.payload.expiresAt).toISOString()}\nNo payment has been executed.`;
   verifiedExpiry=r.payload.expiresAt;expiryTimer=setTimeout(expireIfNeeded,Math.max(0,verifiedExpiry-Date.now()));
  }else $('result').textContent=`Not verified.\nSignature: ${r.signatureValid?'valid':'INVALID — content or signature mismatch'}\nExpected key: ${r.trusted?'matches':'NOT MATCHED'}\nTime window: ${current?'current':'EXPIRED OR NOT YET VALID'}`;
 }catch{if(version===revision)$('result').textContent='Not verified. Invalid JSON, unsupported request format, key or signature.';}
 finally{$('verify').disabled=false;}
};
mountTrustbook(document.getElementById('trustbook'),$('expected'),()=>invalidate(''));
for(const id of ['envelope','expected'])$(id).addEventListener('input',()=>invalidate());
window.addEventListener('focus',expireIfNeeded);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)expireIfNeeded();});

