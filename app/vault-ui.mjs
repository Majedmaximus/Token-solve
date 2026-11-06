import {encryptBackup,decryptBackup} from './recovery-vault.mjs';
const $=id=>document.getElementById(id);
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function run(decrypt){$('encrypt').disabled=$('decrypt').disabled=true;try{
 const file=$('file').files[0],password=$('password').value;if(!file)throw Error('اختر الملف أولًا.');if(file.size>24*1024*1024)throw Error('الملف أكبر من الحد المسموح.');$('status').textContent='العملية محلية داخل المتصفح…';
 if(decrypt){const envelope=JSON.parse(await file.text());download(await decryptBackup(envelope,password),envelope.name,'application/zip');$('status').textContent='تم فك التشفير والتحقق من سلامة الملف.';}
 else{if(password!==$('confirm').value)throw Error('عبارتا المرور غير متطابقتين.');const envelope=await encryptBackup(new Uint8Array(await file.arrayBuffer()),password,file.name);download(JSON.stringify(envelope),file.name+'.vault.json','application/json');$('status').textContent='تم حفظ الملف المشفّر. اختبر فتحه واحفظ نسختك بمكان مستقل.';}
 }catch(e){$('status').textContent=e.message;}finally{$('password').value='';$('confirm').value='';$('encrypt').disabled=$('decrypt').disabled=false;}}
$('encrypt').onclick=()=>run(false);$('decrypt').onclick=()=>run(true);
