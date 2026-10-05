import json
import logging
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from startup import single_instance
from auto_start import create_shortcut, ps_quote
from launcher import LogStream


class StartupTests(unittest.TestCase):
    def test_lock_blocks_another_process_and_is_released(self):
        with tempfile.TemporaryDirectory() as folder:
            module = str(Path(__file__).resolve().parents[1])
            script = 'import sys;sys.path.insert(0,sys.argv[1]);from startup import single_instance\nwith single_instance(sys.argv[2]):print("acquired")'
            with single_instance(folder):
                result = subprocess.run([sys.executable,'-c',script,module,folder],capture_output=True,text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('déjà lancé', result.stderr)
            result = subprocess.run([sys.executable,'-c',script,module,folder],capture_output=True,text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('acquired',result.stdout)

    def test_hidden_launcher_log_excludes_pairing_code_in_multiline_output(self):
        from unittest.mock import Mock
        logger = Mock(spec=logging.Logger)
        LogStream(logger).write('POLYGLOT LOCAL\nCode d’association : 123456\nTranscription locale')
        messages = [call.args[0] for call in logger.info.call_args_list]
        self.assertEqual(messages, ['POLYGLOT LOCAL','Transcription locale'])

    @unittest.skipUnless(sys.platform == 'win32', 'Windows shortcut integration')
    def test_windows_shortcut_with_spaces_and_apostrophe_preserves_launch_arguments(self):
        with tempfile.TemporaryDirectory(prefix="polyglot l'utilisateur ") as folder:
            root = Path(folder); link=root/'Polyglot Local.lnk'
            create_shortcut(link,sys.executable,root,precision=True)
            self.assertTrue(link.is_file())
            script=f'$s=(New-Object -ComObject WScript.Shell).CreateShortcut({ps_quote(link)}); @{{target=$s.TargetPath;arguments=$s.Arguments;working=$s.WorkingDirectory}}|ConvertTo-Json'
            result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],capture_output=True,text=True,check=True)
            values=json.loads(result.stdout)
            self.assertEqual(Path(values['target']),Path(sys.executable))
            self.assertEqual(values['arguments'],'"'+str(root/'launcher.py')+'" --precision')
            self.assertEqual(Path(values['working']),root)
