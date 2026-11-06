// Public-key pins only. Local storage is not a tamper-proof identity directory.
export function contact(name,fingerprint){
 if(typeof name!=='string'||!name.trim()||name.trim().length>60)throw Error('Use a contact name of 1–60 characters.');
 if(typeof fingerprint!=='string'||! /^[a-f0-9]{64}$/i.test(fingerprint.trim()))throw Error('Fingerprint must contain exactly 64 hex characters.');
 return {name:name.trim(),fingerprint:fingerprint.trim().toLowerCase()};
}
export function addContact(book,name,fingerprint){
 const next=contact(name,fingerprint);
 const existing=book.find(x=>x.name.toLowerCase()===next.name.toLowerCase());
 if(existing&&existing.fingerprint!==next.fingerprint)throw Error('Key change blocked. Independently verify the new key, then explicitly remove the old contact before adding a replacement.');
 if(existing)return [...book];
 if(book.length>=100)throw Error('Maximum 100 contacts.');
 return [...book,next].sort((a,b)=>a.name.localeCompare(b.name));
}
export function importContacts(book,text){
 if(typeof text!=='string'||text.length>30000)throw Error('Contact file is too large.');
 const data=JSON.parse(text);
 if(data?.format!=='trace-public-contacts/v1'||!Array.isArray(data.contacts)||data.contacts.length>100)throw Error('Unsupported contact file.');
 let merged=[...book];
 for(const row of data.contacts){
  if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='fingerprint,name')throw Error('Invalid contact record.');
  merged=addContact(merged,row.name,row.fingerprint);
 }
 return merged;
}
export function exportContacts(book){return JSON.stringify({format:'trace-public-contacts/v1',contacts:book},null,2);}
