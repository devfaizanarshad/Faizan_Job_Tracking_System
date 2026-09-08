import fs from 'node:fs';
import readline from 'node:readline';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node postgres16-restore-compat.js INPUT.sql OUTPUT.sql');
const reader=readline.createInterface({input:fs.createReadStream(input,{encoding:'utf8'}),crlfDelay:Infinity});
const writer=fs.createWriteStream(output,{encoding:'utf8',flags:'wx'});
let removed=0;
for await(const line of reader){
  if(line.trim()==='SET transaction_timeout = 0;'){removed++;continue;}
  if(!writer.write(`${line}\n`))await new Promise(resolve=>writer.once('drain',resolve));
}
await new Promise((resolve,reject)=>{writer.on('error',reject);writer.end(resolve);});
if(removed!==1){await fs.promises.rm(output,{force:true});throw new Error(`Expected exactly one PostgreSQL 18 transaction_timeout setting; found ${removed}`);}
console.log(JSON.stringify({input,output,removed,compatibilityTarget:'PostgreSQL 16'}));
