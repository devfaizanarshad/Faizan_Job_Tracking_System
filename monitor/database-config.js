const REQUIRED_PRODUCTION_VARIABLES=['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD'];

export function databaseConfig(options={}){
  if(process.env.NODE_ENV==='production'){
    const missing=REQUIRED_PRODUCTION_VARIABLES.filter(name=>!process.env[name]);
    if(missing.length)throw new Error(`Missing required production database environment variables: ${missing.join(', ')}`);
  }
  const port=Number(process.env.PGPORT||5432);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PGPORT must be an integer between 1 and 65535');
  return {
    host:process.env.PGHOST||'localhost',
    port,
    database:process.env.PGDATABASE||'faizan_employer_intelligence',
    user:process.env.PGUSER||options.defaultUser||'postgres',
    password:process.env.PGPASSWORD,
    ...(options.max?{max:options.max}:{}),
    ...(options.connectionTimeoutMillis?{connectionTimeoutMillis:options.connectionTimeoutMillis}:{})
  };
}

export const productionDatabaseEnvironmentNames=Object.freeze([...REQUIRED_PRODUCTION_VARIABLES]);
