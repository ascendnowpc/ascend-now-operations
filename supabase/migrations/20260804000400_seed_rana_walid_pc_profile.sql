-- Data migration: fill in Rana Walid's performance-coach profile card.
--
-- 20260804000100 created her pc_profiles row empty and unpublished, on the
-- grounds that the card's copy is the coach's own to write. The client has now
-- supplied the finished card, so this fills it in and publishes it — once
-- is_published is true, her assigned students (currently Batu Ozcelik, S1) see
-- it at the top of their Overview tab.
--
-- Shapes follow src/types/database.ts:
--   * achievements           -> PcAchievement[]  { student_name, subject, institutions,
--                                                  institution_logo_urls, score_before,
--                                                  score_after, score_scale, helped[] }
--   * coach_responsibilities -> PcCardEntry[]    { icon, heading, text }
--   * education              -> PcCardEntry[]    { icon, heading, text }
--
-- Notes on faithfulness to the supplied card:
--
-- 1. `score_scale` stores the bare number ("8", "5"). PcProfileCard renders it
--    as `/{score_scale}`, so storing "/8" would print "//8".
--
-- 2. The "Performance Coach" heading and the "ASCEND NOW" label above the
--    responsibilities timeline are hardcoded in PcProfileCard — they are not
--    stored here.
--
-- 3. `educator_experience` is deliberately left EMPTY even though the supplied
--    card has an "Educator Experience" section. That section was removed from
--    this feature: PcProfileCard never renders the field, and PcProfileEditor
--    hardcodes `educator_experience: []` on every save ("always cleared so a
--    previously-saved value can't linger on the card"). Storing the three
--    bullets here would therefore display nowhere and be wiped the first time
--    Rana saves her profile. Restoring that section needs a UI change first.
--
-- 4. `photo_url` is left NULL — the card's headshot has to be uploaded to the
--    public `pc-profiles` bucket through the UI; it cannot be created from SQL.
--    The card falls back to her initials until then.
--
-- 5. The responsibilities timeline renders `heading` bold and `text` small
--    underneath, so each of the four supplied bullets keeps its full sentence
--    in `text` and gets a short label in `heading` drawn from that same
--    sentence. No claim is added that the card did not already make.
--
-- Idempotent: keyed on the teacher's email, and re-running just rewrites the
-- same values.

update public.pc_profiles p
set
  department = 'Management',
  headline   = 'Performance Coach',
  about      = $about$Education and growth have always been at the heart of what I do. I believe learning is most powerful when it connects to purpose and curiosity. With my background as a Child and Adolescent Psychologist, I love guiding students in meaningful ways, helping them navigate challenges, uncover their strengths, and approach their goals with confidence. There's nothing more rewarding than seeing a student light up when they realize what they can achieve, and knowing I played a part in that moment is why I do what I do.$about$,

  achievements = $achievements$[
    {
      "student_name": "Ariel F",
      "subject": "MYP 4 Math",
      "institutions": "World Academy",
      "institution_logo_urls": [],
      "score_before": "3",
      "score_after": "6",
      "score_scale": "8",
      "helped": [
        "Time management optimization.",
        "Mentoring support."
      ]
    },
    {
      "student_name": "Tobias B",
      "subject": "AP Calculus BC",
      "institutions": "JIS · NYU",
      "institution_logo_urls": [],
      "score_before": "2",
      "score_after": "5",
      "score_scale": "5",
      "helped": [
        "Memorisation & Practice technique.",
        "Expertise support"
      ]
    }
  ]$achievements$::jsonb,

  -- Removed from the feature — see note 3 above.
  educator_experience = '[]'::jsonb,

  coach_responsibilities = $resp$[
    {
      "icon": "calendar",
      "heading": "Mentoring since early 2024",
      "text": "Mentoring students since early 2024; coordinating, organising and monitoring the students' lesson schedules."
    },
    {
      "icon": "message",
      "heading": "Student communication",
      "text": "Communicate with the student with regards to their performance and let them know that there is support if asked for or needed."
    },
    {
      "icon": "people",
      "heading": "Teacher liaison",
      "text": "Liaise with the teachers and coordinate the student-teacher schedule."
    },
    {
      "icon": "chart",
      "heading": "Parent updates",
      "text": "Regularly communicate with the parents to keep them informed of their child's progress, conveying the teachers' insights."
    }
  ]$resp$::jsonb,

  education = $edu$[
    {
      "icon": "cap",
      "heading": "MA in Child and Adolescent Psychology",
      "text": "The American College in Greece."
    },
    {
      "icon": "cap",
      "heading": "BA in Psychology",
      "text": "The American University in Egypt."
    },
    {
      "icon": "cap",
      "heading": "BA in Integrated Marketing Communication",
      "text": "The American University in Egypt."
    }
  ]$edu$::jsonb,

  contact_email = 'rana.walid@ascendnow.info',
  contact_phone = '+20 107 028 1012',
  is_published  = true
from public.teachers t
where t.id = p.teacher_id
  and t.email = 'rana.walid@ascendnow.info';
