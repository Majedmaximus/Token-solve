// Browser/Node Web Crypto only. No blockchain transaction or external service.
const domain='trace-payment-request/v1';
const fields=['domain','id','chainId','asset','amount','recipient','purpose','issuedAt','expiresAt'];
const encoder=new TextEncoder();
function canonical(p){
 if(!p||typeof p!=='object'||Object.keys(p).length!==fields.length||!fields.every(k=>Object.hasOwn(p,k)))throw Error('Unexpected request fields.');
 if(p.domain!==domain||typeof p.id!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(p.id))throw Error('Invalid request identity.');
 if(typeof p.chainId!=='string'||! /^[1-9][0-9]{0,9}$/.test(p.chainId))throw Error('Invalid chain ID.');
 if(typeof p.asset!=='string'||!(p.asset==='native'||/^0x[0-9a-fA-F]{40}$/.test(p.asset)))throw Error('Asset must be native or an EVM token address.');
 if(typeof p.amount!=='string'||! /^(0|[1-9][0-9]{0,29})(\.[0-9]{1,18})?$/.test(p.amount)||!/[1-9]/.test(p.amount))throw Error('Enter a positive decimal amount, up to 18 decimal places.');
 if(typeof p.recipient!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(p.recipient)||/^0x0{40}$/i.test(p.recipient))throw Error('Enter a nonzero EVM recipient address.');
 if(typeof p.purpose!=='string'||p.purpose.length<1||p.purpose.length>280||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(p.purpose))throw Error('Purpose must contain 1–280 characters.');
 if(!Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||p.issuedAt<0||p.expiresAt<=p.issuedAt||p.expiresAt-p.issuedAt>86400000)throw Error('Invalid validity window. Maximum: 24 hours.');
 return encoder.encode(JSON.stringify(Object.fromEntries(fields.map(k=>[k,p[k]]))));
}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)));}
function unb64(s,max){if(typeof s!=='string'||s.length>max||! /^[A-Za-z0-9+/]+={0,2}$/.test(s))throw Error('Invalid encoded key or signature.');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export async function createIdentity(){return crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);}
export async function exportPublicKey(key){return b64(await crypto.subtle.exportKey('spki',key));}
export async function fingerprint(publicKey){const bytes=unb64(publicKey,512);const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function signRequest(identity,input,now=Date.now()){
 const payload={domain,id:crypto.randomUUID(),chainId:input.chainId,asset:input.asset,amount:input.amount,recipient:input.recipient,purpose:input.purpose,issuedAt:now,expiresAt:now+15*60*1000};
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.privateKey,canonical(payload));
 return {payload,publicKey:await exportPublicKey(identity.publicKey),signature:b64(signature)};
}
export async function verifyRequest(envelope,expectedFingerprint,now){
 if(!envelope||Object.keys(envelope).sort().join(',')!=='payload,publicKey,signature')throw Error('Invalid signed envelope.');
 const data=canonical(envelope.payload);
 const key=await crypto.subtle.importKey('spki',unb64(envelope.publicKey,512),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const actualFingerprint=await fingerprint(envelope.publicKey);
 const signatureValid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unb64(envelope.signature,256),data);
 const trusted=typeof expectedFingerprint==='string'&&/^[a-f0-9]{64}$/i.test(expectedFingerprint)&&actualFingerprint===expectedFingerprint.toLowerCase();
 const checkedAt=now??Date.now();
 const inTime=envelope.payload.issuedAt<=checkedAt&&checkedAt<envelope.payload.expiresAt;
 return {signatureValid,trusted,inTime,verified:signatureValid&&trusted&&inTime,actualFingerprint,payload:envelope.payload};
}

export async function requestDigest(envelope){
 const digest=await crypto.subtle.digest('SHA-256',canonical(envelope.payload));
 return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function revocationBytes(p){
 const names=['domain','requestId','fingerprint','issuedAt'];
 if(!p||Object.keys(p).length!==names.length||!names.every(k=>Object.hasOwn(p,k))||p.domain!=='trace-revoke/v1'||typeof p.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(p.requestId)||typeof p.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.fingerprint)||!Number.isSafeInteger(p.issuedAt)||p.issuedAt<0)throw Error('Invalid revocation fields.');
 return encoder.encode(JSON.stringify(Object.fromEntries(names.map(k=>[k,p[k]]))));
}
export async function signRevocation(identity,envelope,now=Date.now()){
 const publicKey=await exportPublicKey(identity.publicKey);
 if(publicKey!==envelope.publicKey)throw Error('Only the original signing key can revoke this request.');
 const check=await verifyRequest(envelope,await fingerprint(publicKey),now);
 if(!check.signatureValid)throw Error('Cannot revoke an invalid request.');
 const payload={domain:'trace-revoke/v1',requestId:envelope.payload.id,fingerprint:await fingerprint(publicKey),issuedAt:now};
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.privateKey,revocationBytes(payload));
 return {payload,publicKey,signature:b64(signature)};
}
export async function verifyRevocation(envelope,now=Date.now()){
 if(!envelope||Object.keys(envelope).sort().join(',')!=='payload,publicKey,signature')throw Error('Invalid revocation envelope.');
 const data=revocationBytes(envelope.payload);
 const key=await crypto.subtle.importKey('spki',unb64(envelope.publicKey,512),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const f=await fingerprint(envelope.publicKey);
 const valid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unb64(envelope.signature,256),data);
 if(!valid||f!==envelope.payload.fingerprint||envelope.payload.issuedAt>now)throw Error('Revocation is not signed by the request key or is future-dated.');
 return envelope.payload;
}
