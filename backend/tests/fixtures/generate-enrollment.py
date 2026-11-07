"""Regenerate synthetic enrollment vectors: Python cbor2/asn1crypto and OpenSSL CLI.
Private keys are generated inside TemporaryDirectory and discarded. Production never accepts roots
from this fixture. Run in an isolated venv with cbor2==6.2.1 and asn1crypto==1.5.1.
"""
import base64, hashlib, json, pathlib, subprocess, tempfile, datetime
import cbor2
from asn1crypto import core
class AppleNonce(core.Sequence):
    _fields=[('nonce',core.OctetString,{'explicit':1})]
class Attribute(core.Sequence):
    _fields=[('kind',core.Integer),('version',core.Integer),('value',core.OctetString)]
class Payload(core.SetOf):
    _child_spec=Attribute
output=pathlib.Path(__file__).parent/'enrollment.json'
now=datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
app='TEAM123456.app.test.Folding'; challenge=bytes([8])*32
with tempfile.TemporaryDirectory() as temporary:
    folder=pathlib.Path(temporary)
    def run(*args):return subprocess.run(['openssl',*args],cwd=folder,capture_output=True,check=True).stdout
    def key(name,curve):run('ecparam','-name',curve,'-genkey','-noout','-out',name+'.key')
    def root(name):
        key(name,'secp384r1')
        run('req','-new','-x509','-key',name+'.key','-sha384','-days','3650','-subj','/CN=Synthetic Folding '+name,'-out',name+'.pem','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
    def leaf(name,issuer,extensions):
        run('req','-new','-key',name+'.key','-subj','/CN=Synthetic Folding '+name,'-out',name+'.csr')
        (folder/(name+'.ext')).write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n'+extensions)
        run('x509','-req','-in',name+'.csr','-CA',issuer+'.pem','-CAkey',issuer+'.key','-CAcreateserial','-days','365','-sha256','-extfile',name+'.ext','-out',name+'.pem')
    def certificate(name):return run('x509','-in',name+'.pem','-outform','DER')
    def encode(value):return base64.b64encode(value).decode()
    root('attestation-root');root('receipt-root');key('credential','prime256v1');key('receipt-signer','prime256v1')
    public=run('pkey','-in','credential.key','-pubout','-outform','DER')[-65:]
    assert len(public)==65 and public[0]==4
    key_id=hashlib.sha256(public).digest();client_hash=hashlib.sha256(challenge).digest()
    cose={1:2,3:-7,-1:1,-2:public[1:33],-3:public[33:]}
    extensions={'apple_validation_category_01':(3).to_bytes(4,'little'),'apple_bundle_version_01':'1'}
    auth=hashlib.sha256(app.encode()).digest()+b'\x40'+bytes(4)+b'appattestdevelop'+b'\x00\x20'+key_id+cbor2.dumps(cose)+cbor2.dumps(extensions)
    nonce=hashlib.sha256(auth+client_hash).digest()
    leaf('credential','attestation-root','extendedKeyUsage=1.2.840.113635.100.4.24\n1.2.840.113635.100.8.2=DER:'+AppleNonce({'nonce':nonce}).dump().hex(':')+'\n')
    leaf('receipt-signer','receipt-root','1.2.840.113635.100.12.15=DER:05:00\n')
    timestamp=lambda date:date.isoformat(timespec='milliseconds').replace('+00:00','Z').encode()
    attrs={2:app.encode(),3:certificate('credential'),4:client_hash,5:b'synthetic-token',6:b'ATTEST',7:b'sandbox',12:timestamp(now),21:timestamp(now+datetime.timedelta(days=30))}
    def receipt(changes=None,duplicate=False,noattrs=False):
        values={**attrs,**(changes or {})}
        items=[{'kind':kind,'version':1,'value':value} for kind,value in values.items()]
        if duplicate:items.append({'kind':2,'version':1,'value':app.encode()})
        (folder/'payload.der').write_bytes(Payload(items).dump())
        args=['cms','-sign','-binary','-nodetach','-nosmimecap','-md','sha256','-in','payload.der','-signer','receipt-signer.pem','-inkey','receipt-signer.key','-certfile','receipt-root.pem','-outform','DER']
        if noattrs:args+=['-noattr','-stream']
        return run(*args)
    valid=receipt();raw=receipt(noattrs=True)
    obj={'fmt':'apple-appattest','attStmt':{'x5c':[certificate('credential')],'receipt':valid},'authData':auth}
    result={'provenance':'Synthetic OpenSSL P384 CAs / P256 credential+receipt signer; cbor2/asn1crypto. Private keys discarded.', 'app_id':app,'verification_time_ms':int(now.timestamp()*1000)+1000,'client_hash':encode(client_hash),'challenge':encode(challenge),'key_id':encode(key_id),'public_key_sec1':encode(public),'attestation_root':encode(certificate('attestation-root')),'receipt_root':encode(certificate('receipt-root')),'attestation':encode(cbor2.dumps(obj)),'receipt':encode(valid),'receipt_no_attributes_ber':encode(raw),'bad_receipts':{name:encode(value) for name,value in {'wrong_app':receipt({2:b'OTHER.app'}),'wrong_hash':receipt({4:bytes(32)}),'wrong_type':receipt({6:b'RECEIPT'}),'stale':receipt({12:timestamp(now-datetime.timedelta(minutes=6))}),'future':receipt({12:timestamp(now+datetime.timedelta(minutes=1))}),'duplicate':receipt(duplicate=True)}.items()}}
output.write_text(json.dumps(result,indent=2)+'\n')
