"""The supplement must leave every other event and its input pack alone."""
from copy import deepcopy
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('mortar', Path(__file__).with_name('prepare-war3-mortar.py'))
mortar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mortar)


class MortarSupplementTest(unittest.TestCase):
    def setUp(self):
        self.pack = {'name': 'Warcraft III', 'sounds': {
            'cannonShot': {'file': '08767be75a63ac43.ogg', 'volume': .8, 'pitch': .025},
            'mortarShot': {'file': '08767be75a63ac43.ogg', 'volume': .8, 'pitch': .025},
            'grapeshotShot': {'file': '08767be75a63ac43.ogg', 'volume': .7, 'pitch': .025},
            'shipShot': {'file': 'other.ogg', 'kinds': {'cutter': {'file': 'arrow.ogg'}}},
        }, 'otherMetadata': {'keep': True}}

    def test_only_mortar_file_changes_without_mutating_input(self):
        before = deepcopy(self.pack)
        result = mortar.manifest_with_mortar(self.pack)
        self.assertEqual(self.pack, before)
        self.assertNotEqual(result['sounds']['mortarShot']['file'], before['sounds']['mortarShot']['file'])
        result['sounds']['mortarShot']['file'] = before['sounds']['mortarShot']['file']
        self.assertEqual(result, before)

    def test_rejects_other_packs_and_changed_mortar_entries(self):
        for change in ('pack', 'volume', 'variants'):
            with self.subTest(change=change):
                pack = deepcopy(self.pack)
                if change == 'pack':
                    pack['name'] = 'CC0'
                else:
                    pack['sounds']['mortarShot'][change] = .7 if change == 'volume' else ['old.ogg']
                with self.assertRaises(ValueError):
                    mortar.manifest_with_mortar(pack)

    def test_wrong_source_is_rejected_before_any_output_is_written(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / 'unreviewed.mp3'
            source.write_bytes(b'other recording')
            war3, output = root / 'war3', root / 'staged'
            war3.mkdir()
            (war3 / 'extras.json').write_text(json.dumps(self.pack))
            with self.assertRaisesRegex(ValueError, 'high-quality MP3 preview'):
                mortar.prepare(source, war3, output)
            self.assertFalse(output.exists())
            self.assertEqual(json.loads((war3 / 'extras.json').read_text()), self.pack)

    def test_approved_clip_is_copied_exactly_and_existing_sources_are_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source, approved, war3, output = root / 'preview.mp3', root / 'approved.ogg', root / 'war3', root / 'staged'
            source.write_bytes(b'preview fixture')
            approved.write_bytes(b'approved fixture')
            war3.mkdir()
            (war3 / 'extras.json').write_text(json.dumps(self.pack))
            (war3 / 'sources.json').write_text(json.dumps({'existing.wav': 'existing.ogg'}))
            with patch.object(mortar, 'SOURCE_SHA256', hashlib.sha256(source.read_bytes()).hexdigest()), \
                 patch.object(mortar, 'REVIEWED_SHA256', hashlib.sha256(approved.read_bytes()).hexdigest()), \
                 patch.object(mortar.subprocess, 'run') as encode:
                mortar.prepare(source, war3, output, approved)
            encode.assert_not_called()
            self.assertEqual((output / mortar.FILE).read_bytes(), approved.read_bytes())
            self.assertEqual(json.loads((output / 'sources.json').read_text()), {'existing.wav': 'existing.ogg', mortar.SOURCE_KEY: mortar.FILE})
            self.assertEqual(json.loads((war3 / 'extras.json').read_text()), self.pack)
            self.assertEqual(json.loads((output / 'extras.json').read_text()), mortar.manifest_with_mortar(self.pack))

    def test_changed_approved_clip_is_rejected_before_writing_output(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source, approved, output = root / 'preview.mp3', root / 'changed.ogg', root / 'staged'
            source.write_bytes(b'preview fixture')
            approved.write_bytes(b'changed clip')
            with patch.object(mortar, 'SOURCE_SHA256', hashlib.sha256(source.read_bytes()).hexdigest()), \
                 patch.object(mortar.subprocess, 'run') as encode:
                with self.assertRaisesRegex(ValueError, 'exact approved mortar Ogg'):
                    mortar.prepare(source, root / 'war3', output, approved)
            self.assertFalse(output.exists())
            encode.assert_not_called()


if __name__ == '__main__':
    unittest.main()
