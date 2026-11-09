import importlib.util,io,tarfile,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('codex_archive',Path(__file__).parents[1]/'scripts/sanitize-codex-archive.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class CodexArchiveTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name);self.source=self.root/'source.tar.gz';self.out=self.root/'clean.tar.gz'
 def archive(self,link):
  with tarfile.open(self.source,'w:gz') as a:
   m=tarfile.TarInfo('codex-home/auth.json');m.size=4;a.addfile(m,io.BytesIO(b'data'))
   m=tarfile.TarInfo(link);m.type=tarfile.SYMTYPE;m.linkname='/outside';a.addfile(m)
 def test_only_disposable_argument_wrapper_is_omitted(self):
  self.archive('codex-home/tmp/arg0/codex-arg0abc123/apply_patch')
  self.assertEqual(module.sanitize(self.source,self.out),{'omittedTemporaryLinks':1,'retainedEntries':1})
  with tarfile.open(self.out) as a:self.assertEqual(a.extractfile('codex-home/auth.json').read(),b'data')
 def test_retained_links_and_traversal_fail_without_leaving_an_output(self):
  for name in ['codex-home/auth-link.json','../tmp/arg0/codex-arg0abc123/apply_patch','codex-home/tmp/arg0/codex-arg0abc123/auth.json']:
   with self.subTest(name=name):
    self.archive(name)
    with self.assertRaises(ValueError):module.sanitize(self.source,self.out)
    self.assertFalse(self.out.exists())
if __name__=='__main__':unittest.main()
