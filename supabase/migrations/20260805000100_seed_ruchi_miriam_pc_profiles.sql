-- Data migration: fill in Ruchi Steven's and Miriam Hanna's performance-coach
-- profile cards.
--
-- 20260804000100 created both pc_profiles rows empty and unpublished, on the
-- grounds that the card's copy is the coach's own to write. The client has now
-- supplied both finished cards, so this fills them in and publishes them —
-- exactly the same treatment 20260804000400 gave Rana Walid, and the notes in
-- that migration apply here too:
--
-- 1. `score_scale` stores the bare trailing text ("45 (Predicted)", "8", "5"),
--    because PcProfileCard renders it as `/{score_scale}` — a leading slash
--    here would print "//".
--
-- 2. An achievement with only `score_after` set (Ruchi's two IB DP predictions)
--    renders as a single figure rather than a before ➜ after pair; the card
--    already branches on `score_before` being empty. Miriam's two achievements
--    do have both, so they render as the arrow pair.
--
-- 3. The "Performance Coach" heading and the "ASCEND NOW" label above the
--    responsibilities timeline are hardcoded in PcProfileCard, not stored here.
--
-- 4. `educator_experience` is deliberately left EMPTY even though both supplied
--    cards have an "Educator Experience" section. That section was removed from
--    the feature: PcProfileCard never renders the field and PcProfileEditor
--    hardcodes `educator_experience: []` on every save, so storing the bullets
--    would display nowhere and be wiped the first time either coach saves.
--    Restoring that section needs a UI change first.
--
-- 5. `photo_url` is left NULL — a headshot has to be uploaded to the public
--    `pc-profiles` bucket through the UI and can't be created from SQL. Both
--    cards fall back to the coach's initials until then.
--
-- 6. `institution_logo_urls` point at assets already shipped in `public/`
--    (`stanford.avif`, `lse.jpg` for Ruchi; `worldacademy.png`, `jis.png`,
--    `nyu.png` for Miriam), served at the site root. PcProfileCard renders
--    these through a plain `<img src={src}>`, so a root-relative path resolves
--    against the same origin — keeping the logos versioned with the repo
--    instead of depending on a separate bucket upload.
--
-- 7. The responsibilities timeline renders `heading` bold with `text` small
--    underneath, so each supplied bullet keeps its full sentence in `text` and
--    gets a short label in `heading` drawn from that same sentence. No claim is
--    added that the cards did not already make.
--
-- Miriam's two achievements and four responsibilities match Rana's word for
-- word. That is what the client supplied for both cards, so it is reproduced
-- faithfully rather than reworded to look distinct.
--
-- Idempotent: keyed on each teacher's email, and re-running just rewrites the
-- same values.

-- ============================================================================
-- Ruchi Steven
-- ============================================================================
update public.pc_profiles p
set
  department = 'Management',
  headline   = 'Performance Coach',
  about      = $about$As a performance coach specializing in working with children and with a background in education and a passion for helping young minds flourish, I believe in fostering a positive and supportive environment where students feel motivated to learn and grow. Ultimately, my biggest joy is to see my students become the best version of themselves.$about$,

  achievements = $achievements$[
    {
      "student_name": "Annabelle R",
      "subject": "Total IB DP Score",
      "institutions": "Stanford University",
      "institution_logo_urls": ["/stanford.avif"],
      "score_before": "",
      "score_after": "44",
      "score_scale": "45 (Predicted)",
      "helped": [
        "Time management optimization.",
        "Mentoring support."
      ]
    },
    {
      "student_name": "Gwen Z",
      "subject": "Total IB DP Score",
      "institutions": "LSE",
      "institution_logo_urls": ["/lse.jpg"],
      "score_before": "",
      "score_after": "40",
      "score_scale": "45 (Predicted)",
      "helped": [
        "Boosting her grades in a short time frame.",
        "Providing personalized support and resources."
      ]
    }
  ]$achievements$::jsonb,

  -- Removed from the feature — see note 4 above.
  educator_experience = '[]'::jsonb,

  coach_responsibilities = $resp$[
    {
      "icon": "target",
      "heading": "Goal setting with 100+ students",
      "text": "Successfully mentored and coached 100+ students to identify their academic and personal goals and form personalised and effective plans to help achieve these goals."
    },
    {
      "icon": "message",
      "heading": "Motivating students and educators",
      "text": "Skilled in effective communication to motivate both, students and a team of 100+ educators and keep the team engaged and thriving."
    },
    {
      "icon": "people",
      "heading": "Passions into projects",
      "text": "Ability to lead conversations and understand a child's passions and convert them into tangible projects."
    },
    {
      "icon": "heart",
      "heading": "Long-term parent trust",
      "text": "Built trust and satisfaction among parents by demonstrating genuine care and commitment to their child's academic and personal development, resulting in long-term coaching relationships."
    }
  ]$resp$::jsonb,

  education = $edu$[
    {
      "icon": "cap",
      "heading": "Mumbai University Alumna",
      "text": "Hold a double degree in Masters in Commerce and Education from prestigious colleges affiliated with Mumbai University."
    }
  ]$edu$::jsonb,

  contact_email = 'ruchi.steven@ascendnow.info',
  contact_phone = '+91 98920 84766',
  is_published  = true
from public.teachers t
where t.id = p.teacher_id
  and t.email = 'ruchi.steven@ascendnow.info';

-- ============================================================================
-- Miriam Hanna
-- ============================================================================
update public.pc_profiles p
set
  department = 'Management',
  headline   = 'Performance Coach',
  about      = $about$Education has been at the core of my journey — as a postgraduate researcher, a former university teaching assistant, and a creative professional. With a background in visual art and a deep interest in how we learn, I approach education as both a science and an art. My style blends structure with exploration: I support learners in setting goals, experimenting, reflecting, and growing with confidence. Whether in academic or creative settings, I believe in nurturing curiosity, critical thinking, and a love for learning that lasts well beyond the classroom.$about$,

  achievements = $achievements$[
    {
      "student_name": "Ariel F",
      "subject": "MYP 4 Math",
      "institutions": "World Academy",
      "institution_logo_urls": ["/worldacademy.png"],
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
      "institution_logo_urls": ["/jis.png", "/nyu.png"],
      "score_before": "2",
      "score_after": "5",
      "score_scale": "5",
      "helped": [
        "Memorisation & Practice technique.",
        "Expertise support"
      ]
    }
  ]$achievements$::jsonb,

  -- Removed from the feature — see note 4 above.
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
      "icon": "school",
      "heading": "Helwan University, Faculty of Fine Arts",
      "text": "Graduated from Helwan University, Faculty of Fine Arts."
    },
    {
      "icon": "cap",
      "heading": "BFA in Expressive Arts",
      "text": "Helwan University in Cairo (HU)."
    },
    {
      "icon": "cap",
      "heading": "MFA in Scenography and Set Design",
      "text": "Helwan University in Cairo (HU)."
    }
  ]$edu$::jsonb,

  contact_email = 'miriam.hanna@ascendnow.info',
  contact_phone = '+20 15 58117118',
  is_published  = true
from public.teachers t
where t.id = p.teacher_id
  and t.email = 'miriam.hanna@ascendnow.info';
