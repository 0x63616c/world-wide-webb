import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('image_cache', pathlib.Path(__file__).parents[1] / 'runner/images/linux/cache-image.py')
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def fixture(home):
    directory = home / 'fixture'
    directory.mkdir()
    config = b'{"os":"linux","arch":"arm64"}'
    nvram = b'public Linux NVRAM fixture'
    (directory / 'config.json').write_bytes(config)
    (directory / 'nvram.bin').write_bytes(nvram)
    with (directory / 'disk.img').open('wb') as disk:
        disk.seek(32 * 1024 * 1024)
        disk.write(b'last-byte')
    data = (directory / 'disk.img').read_bytes()
    layers = [
        {'mediaType': cache.PREFIX + 'config.v1', 'size': len(config), 'digest': digest(config)},
        {'mediaType': cache.PREFIX + 'disk.v2', 'size': 1, 'digest': digest(b'compressed'),
         'annotations': {'org.cirruslabs.tart.uncompressed-size': str(len(data)),
                         'org.cirruslabs.tart.uncompressed-content-digest': digest(data)}},
        {'mediaType': cache.PREFIX + 'nvram.v1', 'size': len(nvram), 'digest': digest(nvram)},
    ]
    manifest = json.dumps({'layers': layers}).encode()
    (directory / 'manifest.json').write_bytes(manifest)
    image = 'ghcr.io/fixture/linux@' + digest(manifest)
    target = cache.image_path(home, image)
    target.parent.mkdir(parents=True)
    directory.rename(target)
    return image, target


class ImageCacheTests(unittest.TestCase):
    @unittest.skipIf(os.geteuid() == 0, 'cache installation intentionally refuses root')
    def test_private_image_round_trip_preserves_sparse_disk_without_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            source = root / 'source'
            source.mkdir()
            target = root / 'target'
            target.mkdir()
            image, original = fixture(source)
            bundle = root / 'image.tar.gz'
            receipt = cache.pack(source, image, bundle)
            verified = cache.install(target, image, str(bundle))
            self.assertEqual(receipt, verified)
            restored = cache.image_path(target, image)
            self.assertEqual(set(p.name for p in restored.iterdir()), {*cache.FILES, ".explicitly-pulled"})
            self.assertLess((restored / 'disk.img').stat().st_blocks * 512, 1024 * 1024)
            with self.assertRaises(ValueError):
                cache.install(target, image, str(bundle))
            self.assertEqual((restored / 'config.json').read_bytes(), (original / 'config.json').read_bytes())

    @unittest.skipIf(os.geteuid() == 0, 'cache installation intentionally refuses root')
    @unittest.skipUnless(shutil.which('tart'), 'native Tart is required for its real cache GC')
    def test_import_survives_deleting_an_unrelated_tart_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            source, target = root / 'source', root / 'target'
            source.mkdir()
            target.mkdir()
            image, original = fixture(source)
            bundle = root / 'image.tar.gz'
            cache.pack(source, image, bundle)
            cache.install(target, image, str(bundle))
            garbage = image.replace('/fixture/linux@', '/fixture/unused@')
            garbage_path = cache.image_path(target, garbage)
            garbage_path.parent.mkdir(parents=True)
            shutil.copytree(original, garbage_path)
            subprocess.run(['tart', 'delete', garbage],
                           env=dict(os.environ, TART_HOME=str(target), TART_NO_AUTO_PRUNE='1'),
                           capture_output=True, check=True)
            self.assertTrue(cache.image_path(target, image).is_dir(), 'Tart GC removed the imported image')
            self.assertFalse(garbage_path.exists())
            cache.validate(cache.image_path(target, image), image)

    def test_changed_disk_and_wrong_manifest_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            home = pathlib.Path(temp)
            image, directory = fixture(home)
            with (directory / 'disk.img').open('r+b') as disk:
                disk.write(b'corrupted')
            with self.assertRaisesRegex(ValueError, 'manifest chunk'):
                cache.validate(directory, image)
            with self.assertRaisesRegex(ValueError, 'pinned registry digest'):
                cache.validate(directory, image[:-1] + ('0' if image[-1] != '0' else '1'))

    @unittest.skipIf(os.geteuid() == 0, 'cache installation intentionally refuses root')
    def test_traversal_and_links_never_leave_the_staging_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            home = root / 'home'
            home.mkdir()
            for name, kind in [('../escaped', tarfile.REGTYPE), ('disk.img', tarfile.SYMTYPE)]:
                bundle = root / 'bad.tar.gz'
                with tarfile.open(bundle, 'w:gz') as archive:
                    item = tarfile.TarInfo(name)
                    item.type = kind
                    if kind == tarfile.SYMTYPE:
                        item.linkname = '../escaped'
                    archive.addfile(item, io.BytesIO())
                with self.assertRaises(ValueError):
                    cache.install(home, 'ghcr.io/fixture/linux@sha256:' + 'a' * 64, str(bundle))
                self.assertFalse((root / 'escaped').exists())
                self.assertFalse((home / 'cache').exists())

    def test_image_references_cannot_escape_the_cache_namespace(self):
        for image in ['ghcr.io/../linux@sha256:' + 'a' * 64,
                      'ghcr.io/fixture/linux:latest', 'file:///tmp/image']:
            with self.assertRaises(ValueError):
                cache.image_path('/unused', image)
