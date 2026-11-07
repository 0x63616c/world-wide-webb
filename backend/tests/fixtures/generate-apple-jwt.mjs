// Independent Node/OpenSSL synthetic vectors; private keys exist only in process memory.
import { generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const kid='synthetic-apple-key';
const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
const claims={iss:'https://appleid.apple.com',aud:'app.getfolding.Folding.Staging',sub:'synthetic-subject',iat:1000,exp:2000,nonce:'synthetic-nonce'};
const jwt=(changes={},headerChanges={}) => {
 const data=b64({alg:'RS256',kid,...headerChanges})+'.'+b64({...claims,...changes});
 return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
};
const valid=jwt();
const vectors={provenance:'Node node:crypto / OpenSSL, synthetic identity only; generated private key discarded',jwks:{keys:[{...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'}]},valid,rejected:[jwt({aud:'attacker'}),jwt({iss:'https://evil.example'}),jwt({nonce:'other'}),jwt({exp:1500}),jwt({iat:1501}),jwt({sub:''}),jwt({}, {alg:'HS256'}),jwt({}, {kid:'unknown'}),jwt({}, {crit:['unhandled']}),valid.slice(0,-20)+'A'.repeat(20)]};
writeFileSync(new URL('apple-jwt.json',import.meta.url),JSON.stringify(vectors,null,2)+'\n');
