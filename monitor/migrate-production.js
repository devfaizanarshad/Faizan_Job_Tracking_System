import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';

const migrations=['phase2c_schema.sql','phase2d_schema.sql','phase2e_schema.sql','phase2f_schema.sql'];
const client=new pg.Client({host:process.env.PGADMINHOST||'/var/run/postgresql',port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE||'faizan_employer_intelligence',user:process.env.PGADMINUSER||'postgres',password:process.env.PGADMINPASSWORD||undefined});
await client.connect();
try{for(const file of migrations){const sql=await fs.readFile(path.join(runtimePaths.appRoot,'db',file),'utf8');await client.query(sql);console.log(JSON.stringify({migration:file,status:'applied'}));}}finally{await client.end();}
