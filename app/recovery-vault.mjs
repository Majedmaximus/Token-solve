// Local file encryption only. No networking, storage, account keys or recovery backdoor.
const FORMAT='trace-owner-vault/v1',ITERATIONS=600000,MAX=16*1024*1024,encoder=new TextEncoder();
function passwordCheck(password){if(typeof password!=='string'||password.trim().length<16||password.length>1024)throw Error('Use a unique backup passphrase of at least 16 characters. Do not use a wallet seed phrase.');}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
function bytes(text,max){if(typeof text!=='string'||text.length>max||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error('Invalid encrypted file encoding.');return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
function metadata(e){if(e.format!==FORMAT||e.iterations!==ITERATIONS||e.kdf!=='PBKDF2-SHA256'||e.cipher!=='AES-256-GCM'||typeof e.name!=='string'||e.name.length<1||e.name.length>120||/[\/\\\u0000-\u001f\u202a-\u202e\u2066-\u2069]/u.test(e.name))throw Error('Unsupported vault metadata.');return encoder.encode(JSON.stringify({format:e.format,kdf:e.kdf,iterations:e.iterations,cipher:e.cipher,name:e.name}));}
async function key(password,salt){const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function encryptBackup(data,password,name='project-recovery.zip'){
 passwordCheck(password);if(!(data instanceof Uint8Array)||data.length>MAX)throw Error('Backup must be at most 16 MiB.');
 const envelope={format:FORMAT,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-256-GCM',name};const aad=metadata(envelope),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt),data);
 return {...envelope,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};
}
export async function decryptBackup(envelope,password){
 passwordCheck(password);if(!envelope||Object.keys(envelope).sort().join(',')!=='cipher,ciphertext,format,iterations,iv,kdf,name,salt')throw Error('Invalid vault envelope.');
 const aad=metadata(envelope),salt=bytes(envelope.salt,32),iv=bytes(envelope.iv,24),ciphertext=bytes(envelope.ciphertext,Math.ceil((MAX+16)/3)*4);
 if(salt.length!==16||iv.length!==12||ciphertext.length<16||ciphertext.length>MAX+16)throw Error('Invalid vault sizes.');
 try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt),ciphertext));}
 catch{throw Error('Decryption failed: password or file integrity does not match.');}
}
