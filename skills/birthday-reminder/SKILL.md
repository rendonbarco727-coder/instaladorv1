---
name: birthday-reminder
description: Manage birthdays with natural language. Use when the user mentions birthdays, anniversaries, or asks to remember dates for people.
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - sqlite3
---

# Birthday Reminder Skill

## How to use this skill

When the user wants to:
- Add a birthday: save it to memory with the person's name and date
- List birthdays: retrieve all saved birthdays from memory
- Check upcoming birthdays: find birthdays in the next 30 days

## Instructions

1. To save a birthday: use memory_search to store "cumpleaños de [nombre]: [fecha]"
2. To list birthdays: search memory for "cumpleaños"
3. To check upcoming: compare stored dates with today's date

Always confirm to the user what was saved or found.
