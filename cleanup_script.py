import re
import os

file_path = '/Volumes/SSD Rapidor/BANK DOCUMENTS/Mes-Codes/obsidian-simple-tasks-blocks/main.ts'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Normalize indentation: Tabs to 2 spaces
# We assume the file uses tabs (common in the previous tool outputs)
content = content.replace('\t', '  ')

# 2. Remove trailing spaces per line
lines = content.split('\n')
cleaned_lines = [line.rstrip() for line in lines]
content = '\n'.join(cleaned_lines)

# 3. Collapse consecutive empty lines
# Replace 3 or more newlines with 2 newlines (which creates 1 empty line visually)
content = re.sub(r'\n{3,}', '\n\n', content)

# 4. Trim start and end of file
content = content.strip()

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
