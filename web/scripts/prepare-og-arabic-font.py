"""Rebuild the OFL Arabic derivative compatible with Next's bundled Satori."""
from pathlib import Path
from io import BytesIO
import hashlib
import sys
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
source = root / 'scripts/fonts/NotoSansArabic-Regular.ttf'
output = root / 'src/assets/fonts/SpawnForgeArabic-Regular.ttf'
expected = 'ceea25b464a656dc3b26849bab9356740401af62aedf1bfa8b7f0d9b75925b1b'
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise SystemExit('Arabic source changed; review its license and layout compatibility first')
font = TTFont(source, recalcTimestamp=False)
gsub = font['GSUB'].table
encoded = set(font.getBestCmap().values())
kept = [(index, record) for index, record in enumerate(gsub.FeatureList.FeatureRecord)
        if record.FeatureTag in ('init', 'medi', 'fina')]
if {record.FeatureTag for _, record in kept} != {'init', 'medi', 'fina'}:
    raise SystemExit('Source is missing contextual joining features')
remap = {index: new for new, (index, _) in enumerate(kept)}
gsub.FeatureList.FeatureRecord = [record for _, record in kept]
gsub.FeatureList.FeatureCount = len(kept)
for script in gsub.ScriptList.ScriptRecord:
    languages = [script.Script.DefaultLangSys] + [record.LangSys for record in script.Script.LangSysRecord]
    for language in languages:
        if language is not None:
            language.FeatureIndex = [remap[index] for index in language.FeatureIndex if index in remap]
            language.FeatureCount = len(language.FeatureIndex)
            language.ReqFeatureIndex = remap.get(language.ReqFeatureIndex, 65535)
# Next's fallback resolver expects every substituted glyph to have a Unicode
# value. Preserve encoded initial/medial/final forms and exclude unsupported
# advanced ligatures/contextual features that resolve to unencoded glyphs.
for _, record in kept:
    for index in record.Feature.LookupListIndex:
        lookup = gsub.LookupList.Lookup[index]
        if lookup.LookupType != 1:
            raise SystemExit('Unexpected contextual joining lookup type')
        for subtable in lookup.SubTable:
            subtable.mapping = {base: form for base, form in subtable.mapping.items() if form in encoded}
        if not any(subtable.mapping for subtable in lookup.SubTable):
            raise SystemExit('Empty contextual joining lookup')
names = {1: 'SpawnForge Arabic', 3: 'SpawnForge Arabic Regular 2.009',
         4: 'SpawnForge Arabic Regular', 6: 'SpawnForgeArabic-Regular',
         16: 'SpawnForge Arabic', 17: 'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
# Copyright and OFL name records are preserved; derivative names avoid any
# reserved upstream font name. The upstream timestamp is kept for reproducibility.
buffer = BytesIO()
font.save(buffer)
data = buffer.getvalue()
if '--check' in sys.argv:
    if not output.exists() or output.read_bytes() != data:
        raise SystemExit('Arabic derivative is stale; regenerate it with fontTools 4.61.1')
else:
    output.write_bytes(data)
print('Verified Arabic derivative with init/medi/fina joining features')
