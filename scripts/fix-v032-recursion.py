from pathlib import Path
p = Path('extension/background-v3.ts')
s = p.read_text()
old = '''function setChoppingSkill(skill: SkillStateSnapshot) {
  const previous = skillText(choppingSkill);
  const next = skillText(skill);
  setChoppingSkill(skill);'''
new = '''function setChoppingSkill(skill: SkillStateSnapshot) {
  const previous = skillText(choppingSkill);
  const next = skillText(skill);
  choppingSkill = skill;'''
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise RuntimeError('setChoppingSkill helper shape not found')
p.write_text(s)
print('setChoppingSkill recursion guard applied')
