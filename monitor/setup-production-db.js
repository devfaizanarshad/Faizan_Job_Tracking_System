import pg from 'pg';

const role=process.env.APP_DB_USER||'faizan_monitor';
const database=process.env.APP_DB_NAME||'faizan_employer_intelligence';
if(!/^[a-z_][a-z0-9_]*$/.test(role)||!/^[a-z_][a-z0-9_]*$/.test(database))throw new Error('Database and role names must be lowercase SQL identifiers');
if(!process.env.APP_DB_PASSWORD||process.env.APP_DB_PASSWORD.length<24)throw new Error('APP_DB_PASSWORD must contain at least 24 characters');
const admin={host:process.env.PGADMINHOST||'/var/run/postgresql',port:Number(process.env.PGPORT||5432),user:process.env.PGADMINUSER||'postgres',password:process.env.PGADMINPASSWORD||undefined,database:'postgres'};
const control=new pg.Client(admin);await control.connect();
try{
  const literal=(await control.query('SELECT quote_literal($1) value',[process.env.APP_DB_PASSWORD])).rows[0].value;
  if(!(await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await control.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal}`);
  else await control.query(`ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal}`);
  if(!(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount)await control.query(`CREATE DATABASE ${database} ENCODING 'UTF8' TEMPLATE template0`);
  await control.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);await control.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
}finally{await control.end();}
const target=new pg.Client({...admin,database});await target.connect();
try{
  await target.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');await target.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await target.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);await target.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await target.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${role}`);await target.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${role}`);
}finally{await target.end();}
console.log(JSON.stringify({status:'configured',database,role,encoding:'UTF8',leastPrivilege:true}));
