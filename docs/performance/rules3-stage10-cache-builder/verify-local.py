import subprocess,sys
from pathlib import Path
sys.exit(subprocess.call([sys.executable,str(Path(__file__).with_name('analyze-native.py'))]))
