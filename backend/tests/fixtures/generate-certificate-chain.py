"""OpenSSL synthetic CA/credential vector. Temporary private keys are deleted on exit."""
import subprocess, tempfile, pathlib, json, base64, time
out=pathlib.Path(__file__).parent
with tempfile.TemporaryDirectory() as folder:
    path=pathlib.Path(folder)
    def run(*args):
        return subprocess.run(['openssl',*args],cwd=folder,check=True,capture_output=True).stdout
    run('ecparam','-name','secp384r1','-genkey','-noout','-out','root.key')
    run('req','-new','-x509','-key','root.key','-sha384','-days','3650','-subj','/CN=Synthetic Folding Test Root','-out','root.pem','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
    run('ecparam','-name','prime256v1','-genkey','-noout','-out','leaf.key')
    run('req','-new','-key','leaf.key','-subj','/CN=Synthetic Folding Credential','-out','leaf.csr')
    (path/'leaf.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.8.2=DER:30:24:A1:22:04:20:'+':'.join(['03']*32)+'\n')
    run('x509','-req','-in','leaf.csr','-CA','root.pem','-CAkey','root.key','-CAcreateserial','-days','365','-sha384','-extfile','leaf.ext','-out','leaf.pem')
    cert=lambda name:base64.b64encode(run('x509','-in',name+'.pem','-outform','DER')).decode()
    (out/'certificate-chain.json').write_text(json.dumps({'provenance':'Synthetic OpenSSL P384 root and P256 leaf; no Apple attestation; private keys discarded','root':cert('root'),'leaf':cert('leaf'),'verified_at_seconds':int(time.time())},indent=2)+'\n')
