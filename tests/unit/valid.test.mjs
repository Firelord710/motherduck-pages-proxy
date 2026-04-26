// Validation tests for legitimate SELECT-style queries.
//
// Every case in here MUST pass validateReadOnly (return null). Failures
// indicate the query proxy would brick a legitimate dashboard read. Real
// production queries are pulled verbatim from
// shooting_dashboard/src/App.tsx (with placeholder substitution for
// runtime ${} interpolations) and live alongside synthesized cases that
// stress the validator's whitespace, comment, literal, identifier, and
// CTE handling.

import { runValidatorCases } from "../helpers/validator-harness.mjs";

// Generic FQN — value doesn't matter, only that the validator allows it.
// Originally `"shooting"."main"` from shooting_dashboard.
const SHOOTING = `"app"."main"`;

const cases = [];

// ============================================================================
// 1. Real-world queries pulled from src/App.tsx (~30+ verbatim, with ${}
//    interpolations replaced by realistic literal substitutions).
// ============================================================================

// --- Match count (DashboardStats) ---
cases.push({
  name: "real:matchcount.no-where",
  sql: `SELECT COUNT(*)::BIGINT AS n FROM ${SHOOTING}."matches" m `,
  expect: "valid",
});
cases.push({
  name: "real:matchcount.with-where",
  sql: `SELECT COUNT(*)::BIGINT AS n FROM ${SHOOTING}."matches" m WHERE m.state = 'AZ' AND m.match_date BETWEEN '2025-01-01' AND '2025-12-31'`,
  expect: "valid",
});

// --- Top-of-page stats card ---
cases.push({
  name: "real:topstats.subselects",
  sql: `
    SELECT
      (SELECT COUNT(*) FROM ${SHOOTING}."matches" m WHERE m.first_seen_at >= '2025-01-01')::BIGINT AS new_since,
      (SELECT COUNT(*) FROM ${SHOOTING}."upcoming_matches" m WHERE m.match_date <= CURRENT_DATE + 14)::BIGINT AS upcoming_14,
      (SELECT COUNT(*) FROM ${SHOOTING}."matches" m WHERE m.state = 'AZ')::BIGINT AS indexed,
      (SELECT COUNT(*) FROM ${SHOOTING}."matches")::BIGINT            AS indexed_total
  `,
  expect: "valid",
});

// --- FIELD_STRENGTH_AGG_CTE ---
const FIELD_STRENGTH_AGG_CTE = `
  match_field_strength_agg AS (
    SELECT
      match_uuid,
      ARG_MAX(strength_bucket,
        CASE strength_bucket
          WHEN 'elite'   THEN 4
          WHEN 'strong'  THEN 3
          WHEN 'typical' THEN 2
          WHEN 'weak'    THEN 1
          ELSE 0
        END
      ) AS strength_bucket
    FROM ${SHOOTING}."match_field_strength"
    GROUP BY match_uuid
  )
`;

// --- RecentlyAddedTab ---
cases.push({
  name: "real:recentlyadded.cte+join",
  sql: `
    WITH ${FIELD_STRENGTH_AGG_CTE}
    SELECT m.match_uuid, CAST(m.match_date AS VARCHAR) AS match_date,
           m.match_name, m.club, m.state, m.match_type, m.num_shooters, m.num_stages,
           m.practiscore_url, CAST(m.first_seen_at AS VARCHAR) AS first_seen_at,
           mfs.strength_bucket
    FROM ${SHOOTING}."matches" m
    LEFT JOIN match_field_strength_agg mfs USING (match_uuid)
    WHERE m.state = 'AZ'
    ORDER BY m.first_seen_at DESC NULLS LAST
    LIMIT 500
  `,
  expect: "valid",
});

cases.push({
  name: "real:recentlyadded.strongonly",
  sql: `
    WITH ${FIELD_STRENGTH_AGG_CTE}
    SELECT m.match_uuid, CAST(m.match_date AS VARCHAR) AS match_date,
           m.match_name, m.club, m.state, m.match_type, m.num_shooters, m.num_stages,
           m.practiscore_url, CAST(m.first_seen_at AS VARCHAR) AS first_seen_at,
           mfs.strength_bucket
    FROM ${SHOOTING}."matches" m
    LEFT JOIN match_field_strength_agg mfs USING (match_uuid)
    WHERE m.state = 'AZ' AND mfs.strength_bucket IN ('strong','elite')
    ORDER BY m.first_seen_at DESC NULLS LAST
    LIMIT 500
  `,
  expect: "valid",
});

// --- UpcomingTab union ---
cases.push({
  name: "real:upcoming.union",
  sql: `
    WITH fut_m AS (
      SELECT m.match_uuid, CAST(m.match_date AS VARCHAR) AS match_date,
             m.match_name, m.club, m.state, m.match_type, m.num_shooters, m.num_stages,
             m.level, m.status,
             CAST(m.reg_open_date AS VARCHAR) AS reg_open_date,
             m.price_cents,
             m.practiscore_url, CAST(m.first_seen_at AS VARCHAR) AS first_seen_at,
             'scored/archive' AS source
      FROM ${SHOOTING}."matches" m
      WHERE m.state = 'AZ' AND m.match_date >= CURRENT_DATE
    ),
    fut_u AS (
      SELECT u.match_uuid, CAST(u.match_date AS VARCHAR) AS match_date,
             u.match_name, u.club, u.state, u.match_type,
             NULL::INTEGER AS num_shooters, NULL::INTEGER AS num_stages,
             u.level, u.status,
             CAST(u.reg_open_date AS VARCHAR) AS reg_open_date,
             u.price_cents,
             u.practiscore_url, CAST(u.discovered_at AS VARCHAR) AS first_seen_at,
             'upcoming_index' AS source
      FROM ${SHOOTING}."upcoming_matches" u
      WHERE u.state = 'AZ' AND u.match_date >= CURRENT_DATE
        AND u.match_uuid NOT IN (SELECT match_uuid FROM fut_m)
    )
    SELECT * FROM fut_m
    UNION ALL
    SELECT * FROM fut_u
    ORDER BY match_date ASC
  `,
  expect: "valid",
});

// --- Opening Soon ---
cases.push({
  name: "real:openingsoon",
  sql: `
    SELECT u.match_uuid,
           CAST(u.reg_open_date  AS VARCHAR) AS reg_open_date,
           CAST(u.reg_close_date AS VARCHAR) AS reg_close_date,
           CAST(u.match_date     AS VARCHAR) AS match_date,
           u.match_name, u.club, u.state, u.match_type,
           u.level, u.status,
           NULL::INTEGER AS num_shooters,
           u.max_shooters, u.waitlist_count, u.price_cents,
           u.practiscore_url
    FROM ${SHOOTING}."upcoming_matches" u
    WHERE u.state = 'AZ'
    ORDER BY
      CASE WHEN u.reg_open_date IS NULL THEN 1 ELSE 0 END,
      u.reg_open_date ASC,
      u.match_date ASC
  `,
  expect: "valid",
});

// --- AllMatchesTab ---
cases.push({
  name: "real:allmatches",
  sql: `
    WITH ${FIELD_STRENGTH_AGG_CTE}
    SELECT m.match_uuid, CAST(m.match_date AS VARCHAR) AS match_date,
           m.match_name, m.club, m.state, m.match_type, m.num_shooters, m.num_stages,
           m.practiscore_url, CAST(m.first_seen_at AS VARCHAR) AS first_seen_at,
           mfs.strength_bucket
    FROM ${SHOOTING}."matches" m
    LEFT JOIN match_field_strength_agg mfs USING (match_uuid)
    WHERE m.state = 'AZ'
    ORDER BY m.match_date DESC
  `,
  expect: "valid",
});

// --- ByClubTab ---
cases.push({
  name: "real:byclub",
  sql: `
    WITH ${FIELD_STRENGTH_AGG_CTE}
    SELECT m.club, m.state,
           COUNT(*)::BIGINT AS total_matches,
           ROUND(AVG(m.num_shooters))::INTEGER AS avg_shooters,
           CAST(MAX(m.match_date) AS VARCHAR) AS most_recent,
           CAST(MIN(m.match_date) AS VARCHAR) AS first_match
    FROM ${SHOOTING}."matches" m
    LEFT JOIN match_field_strength_agg mfs USING (match_uuid)
    WHERE m.state = 'AZ' AND m.club IS NOT NULL AND m.club != ''
    GROUP BY m.club, m.state
    ORDER BY total_matches DESC
  `,
  expect: "valid",
});

// --- SHOOTERS_TOP10K_SQL ---
cases.push({
  name: "real:shooters.top10k",
  sql: `
    SELECT scs.shooter_key, scs.object_id, scs.slug, scs.full_name, scs.profile_club,
           scs.titles, scs.image,
           scs.total_matches, scs.linked_ids, scs.states,
           CAST(scs.last_seen AS VARCHAR) AS last_seen,
           src.division_class_pairs AS division_classes,
           COALESCE(scs.search_tokens, LOWER(scs.full_name)) AS _search_tokens
    FROM ${SHOOTING}."shooter_canonical_summary" scs
    LEFT JOIN ${SHOOTING}."shooter_recent_classes" src
      ON src.shooter_key = scs.shooter_key
    ORDER BY scs.total_matches DESC, scs.last_seen DESC
    LIMIT 10000
  `,
  expect: "valid",
});

// --- ShooterProfilesTab fallback (with sqlStr token clauses) ---
cases.push({
  name: "real:shooters.fallback",
  sql: `
      SELECT shooter_key, object_id, slug, full_name, profile_club, titles,
             image, total_matches, linked_ids, states,
             CAST(last_seen AS VARCHAR) AS last_seen
      FROM ${SHOOTING}."shooter_canonical_summary"
      WHERE (COALESCE(search_tokens, name_lower) LIKE '%dennis%' AND COALESCE(search_tokens, name_lower) LIKE '%tran%')
         OR (slug IS NOT NULL AND slug ILIKE '%dennis tran%')
      ORDER BY total_matches DESC, last_seen DESC
      LIMIT 200
  `,
  expect: "valid",
});

// --- ShooterDetailView resolveSql (object_id branch) ---
cases.push({
  name: "real:shooter.resolve.objectid",
  sql: `
        SELECT l.shooter_id, p.object_id, p.slug, p.full_name, p.profile_club,
               p.titles, p.image,
               scs2.member_number              AS member_number,
               scs.total_matches       AS career_total_matches,
               CAST(scs.first_seen AS VARCHAR) AS career_first_seen,
               CAST(scs.last_seen  AS VARCHAR) AS career_last_seen,
               scs.top_club                    AS career_top_club,
               scs.top_discipline              AS career_top_discipline,
               scs.current_class_by_division   AS career_class_by_div,
               scs.career_mean_percentile      AS career_mean_percentile,
               scs.trend_slope_90d             AS career_trend_slope_90d
        FROM (
          SELECT DISTINCT shooter_id, object_id
          FROM ${SHOOTING}."shooter_identity_links"
          WHERE object_id = '308685'
        ) l
        LEFT JOIN (
          SELECT object_id, slug, full_name, club AS profile_club, titles, image
          FROM ${SHOOTING}."profiles"
        ) p ON p.object_id = l.object_id
        LEFT JOIN ${SHOOTING}."shooter_career_summary" scs
          ON scs.canonical_id = l.object_id
        LEFT JOIN ${SHOOTING}."shooter_canonical_summary" scs2
          ON scs2.object_id = l.object_id
  `,
  expect: "valid",
});

// --- ShooterDetailView resolveSql (name fallback) ---
cases.push({
  name: "real:shooter.resolve.name",
  sql: `
      SELECT DISTINCT mr.shooter_id,
             NULL::VARCHAR AS object_id,
             NULL::VARCHAR AS slug,
             'Tran, Dennis' AS full_name,
             NULL::VARCHAR AS profile_club,
             NULL::VARCHAR[] AS titles,
             NULL::VARCHAR AS image,
             NULL::VARCHAR AS member_number,
             NULL::BIGINT  AS career_total_matches,
             NULL::VARCHAR AS career_first_seen,
             NULL::VARCHAR AS career_last_seen,
             NULL::VARCHAR AS career_top_club,
             NULL::VARCHAR AS career_top_discipline,
             NULL::VARCHAR AS career_class_by_div,
             NULL::DOUBLE  AS career_mean_percentile,
             NULL::DOUBLE  AS career_trend_slope_90d
      FROM ${SHOOTING}."match_results" mr
      WHERE mr.shooter_name = 'Tran, Dennis'
  `,
  expect: "valid",
});

// --- bundleMatchesSql ---
cases.push({
  name: "real:bundle.matches",
  sql: `
      SELECT mr.match_uuid,
             CAST(m.match_date AS VARCHAR) AS match_date,
             m.match_name, m.club, m.state, m.match_type,
             m.num_shooters, m.num_stages,
             mr.division, mr.class, mr.power_factor,
             mr.overall_place, mr.match_pct, mr.total_time, mr.is_dq,
             fs.field_mean_hf::DOUBLE   AS field_mean_pct,
             fs.field_stddev_hf::DOUBLE AS field_stddev_pct,
             fs.num_competitors
      FROM ${SHOOTING}."match_results" mr
      JOIN ${SHOOTING}."matches" m USING(match_uuid)
      LEFT JOIN ${SHOOTING}."field_stats" fs USING(match_uuid)
      WHERE mr.shooter_id IN ('mmShooter_1','mmShooter_2','mmShooter_3')
      ORDER BY m.match_date DESC
  `,
  expect: "valid",
});

// --- bundleStagesSql ---
cases.push({
  name: "real:bundle.stages",
  sql: `
      SELECT sr.match_uuid,
             CAST(m.match_date AS VARCHAR) AS match_date,
             m.match_name, m.match_type,
             sr.stage_number, sr.stage_name, sr.classifier_code,
             mr.shooter_name,
             sr.hit_factor::DOUBLE AS hit_factor,
             sr.time_seconds::DOUBLE AS time_seconds,
             sr.stage_pct::DOUBLE AS stage_pct,
             sr.a_hits, sr.c_hits, sr.d_hits,
             sr.mikes, sr.no_shoots, sr.procedurals,
             sr.is_clean,
             sfs.field_mean_hf::DOUBLE   AS field_mean_hf,
             sfs.field_stddev_hf::DOUBLE AS field_stddev_hf,
             CASE WHEN sfs.field_stddev_hf > 0
                  THEN (sr.hit_factor - sfs.field_mean_hf) / sfs.field_stddev_hf
             END AS zscore
      FROM ${SHOOTING}."stage_results" sr
      JOIN ${SHOOTING}."matches" m USING(match_uuid)
      LEFT JOIN ${SHOOTING}."match_results" mr
        ON mr.match_uuid = sr.match_uuid AND mr.shooter_id = sr.shooter_id
      LEFT JOIN ${SHOOTING}."stage_field_stats" sfs
        ON sr.match_uuid = sfs.match_uuid AND sr.stage_number = sfs.stage_number
      WHERE sr.shooter_id IN ('mmShooter_1','mmShooter_2')
      ORDER BY m.match_date, sr.stage_number
  `,
  expect: "valid",
});

// --- videosSql ---
cases.push({
  name: "real:videos",
  sql: `
      SELECT v.shooter_name, v.match_name, v.stage_name, v.vimeo_url
      FROM ${SHOOTING}."videos" v
      WHERE v.vimeo_url IS NOT NULL
        AND v.shooter_name IN (
          SELECT DISTINCT shooter_name
          FROM ${SHOOTING}."match_results"
          WHERE shooter_id IN ('mmShooter_1','mmShooter_2')
            AND shooter_name IS NOT NULL
        )
  `,
  expect: "valid",
});

// --- trajectorySql ---
cases.push({
  name: "real:trajectory",
  sql: `
      SELECT match_uuid,
             CAST(match_date AS VARCHAR) AS match_date,
             division,
             percentile_in_match,
             peer_group_size
      FROM ${SHOOTING}."shooter_percentile_trajectory"
      WHERE canonical_id = '308685'
      ORDER BY match_date
  `,
  expect: "valid",
});

// --- MatchDetailView headerSql ---
cases.push({
  name: "real:match.header",
  sql: `
    SELECT match_name, CAST(match_date AS VARCHAR) AS match_date, club, state, match_type,
           num_shooters, num_stages, practiscore_url, data_quality
    FROM ${SHOOTING}."matches"
    WHERE match_uuid = 'abc-uuid-123'
    LIMIT 1
  `,
  expect: "valid",
});

// --- leaderSql ---
cases.push({
  name: "real:match.leader",
  sql: `
    SELECT shooter_id, shooter_name, division, class, match_pct,
           overall_place, match_points, member_number, is_dq, categories, dq_reason
    FROM ${SHOOTING}."match_results"
    WHERE match_uuid = 'abc-uuid-123'
    ORDER BY overall_place ASC NULLS LAST
  `,
  expect: "valid",
});

// --- stageSql ---
cases.push({
  name: "real:match.stages",
  sql: `
      SELECT stage_number, stage_name, stage_pct, stage_points, classifier_code,
             hit_factor, time_seconds,
             a_hits, c_hits, d_hits, mikes, no_shoots, procedurals
      FROM ${SHOOTING}."stage_results"
      WHERE match_uuid = 'abc-uuid-123' AND shooter_id = 'mmShooter_1'
      ORDER BY stage_number ASC
  `,
  expect: "valid",
});

// --- EventsTab ---
cases.push({
  name: "real:events",
  sql: `
    SELECT
      object_id,
      event_name,
      event_slug,
      CAST(start_date AS VARCHAR) AS start_date,
      CAST(end_date AS VARCHAR)   AS end_date,
      state,
      city,
      country,
      series_type,
      description,
      registration_url,
      match_uuids
    FROM ${SHOOTING}."events"
    ORDER BY
      CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
      start_date DESC
  `,
  expect: "valid",
});

// --- ShooterUpcoming ---
cases.push({
  name: "real:shooter.upcoming",
  sql: `
      SELECT u.match_uuid,
             u.match_name,
             CAST(u.match_date AS VARCHAR) AS match_date,
             u.club,
             u.state,
             u.match_type,
             u.level,
             CAST(u.reg_open_date AS VARCHAR) AS reg_open_date,
             u.practiscore_url,
             r.division,
             r.squad_number,
             r.shooter_class
      FROM ${SHOOTING}."registrations" r
      JOIN ${SHOOTING}."upcoming_matches" u USING (match_uuid)
      WHERE u.match_date >= CURRENT_DATE
        AND (
          lower(r.shooter_name) = lower('Tran, Dennis')
          OR NULLIF(TRIM(r.member_number), '') = 'A138127'
        )
      ORDER BY u.match_date ASC, u.match_name ASC
      LIMIT 50
  `,
  expect: "valid",
});

// --- IdentityOverrideActions: existingSql (overlay table read) ---
cases.push({
  name: "real:identity.existing",
  sql: `
    SELECT merge_from_object_ids, version
    FROM shooting.overlay.overlay_shooter_canonical_merge
    WHERE primary_object_id = '308685'
    LIMIT 1
  `,
  expect: "valid",
});

// --- IdentityOverrideActions: mergedNamesSql ---
cases.push({
  name: "real:identity.merged.names",
  sql: `
      SELECT object_id, full_name, slug
      FROM ${SHOOTING}."profiles"
      WHERE object_id IN ('111','222','333')
  `,
  expect: "valid",
});

// --- ProfilePickerModal ---
cases.push({
  name: "real:profile.picker",
  sql: `
      SELECT object_id, slug, full_name, club, titles
      FROM ${SHOOTING}."profiles"
      WHERE full_name ILIKE '%dennis%'
         OR slug ILIKE '%dennis%'
      ORDER BY updated DESC NULLS LAST
      LIMIT 20
  `,
  expect: "valid",
});

// --- FeedTab matchesSql ---
cases.push({
  name: "real:feed.recent",
  sql: `
    WITH ${FIELD_STRENGTH_AGG_CTE}
    SELECT m.match_uuid, m.match_name, m.club, m.state, m.match_type,
           CAST(m.match_date AS VARCHAR) AS match_date,
           CAST(m.first_seen_at AS VARCHAR) AS first_seen_at,
           m.num_shooters, m.practiscore_url,
           mfs.strength_bucket
    FROM ${SHOOTING}."matches" m
    LEFT JOIN match_field_strength_agg mfs USING (match_uuid)
    WHERE m.state = 'AZ' AND m.first_seen_at >= CURRENT_TIMESTAMP - INTERVAL 7 DAY
    ORDER BY m.first_seen_at DESC NULLS LAST
    LIMIT 30
  `,
  expect: "valid",
});

// --- FeedTab upcomingSql ---
cases.push({
  name: "real:feed.upcoming",
  sql: `
    SELECT u.match_uuid, u.match_name, u.club, u.state, u.match_type,
           CAST(u.match_date AS VARCHAR) AS match_date,
           u.level,
           CAST(u.reg_open_date AS VARCHAR) AS reg_open_date,
           u.practiscore_url
    FROM ${SHOOTING}."upcoming_matches" u
    WHERE u.state = 'AZ' AND u.match_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
    ORDER BY u.match_date ASC
    LIMIT 20
  `,
  expect: "valid",
});

// --- FeedTab trendingSql ---
cases.push({
  name: "real:feed.trending",
  sql: `
    WITH wk AS (
      SELECT canonical_id, COUNT(*) AS matches_this_week
      FROM ${SHOOTING}."shooter_percentile_trajectory"
      WHERE match_date >= CURRENT_DATE - 7
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    )
    SELECT wk.canonical_id, wk.matches_this_week,
           scs.full_name, scs.profile_club, scs.slug
    FROM wk
    LEFT JOIN ${SHOOTING}."shooter_canonical_summary" scs
      ON scs.object_id = wk.canonical_id
    ORDER BY wk.matches_this_week DESC
  `,
  expect: "valid",
});

// --- Classifier divisionsSql ---
cases.push({
  name: "real:classifier.divisions",
  sql: `
    SELECT division, COUNT(*)::BIGINT AS n
    FROM ${SHOOTING}."classifier_attempts"
    WHERE classifier_code = '99-11'
      AND division IS NOT NULL
    GROUP BY division
    ORDER BY n DESC
    LIMIT 20
  `,
  expect: "valid",
});

// --- Classifier defSql ---
cases.push({
  name: "real:classifier.def",
  sql: `SELECT classifier_code, classifier_name, hhf, division
         FROM ${SHOOTING}."classifier_definitions"
         WHERE classifier_code = '99-11'
           AND (division = 'Carry Optics' OR division IS NULL)
         LIMIT 1`,
  expect: "valid",
});

// --- Classifier anyAttemptSql ---
cases.push({
  name: "real:classifier.anyattempt",
  sql: `
    SELECT COUNT(*)::BIGINT AS n
    FROM ${SHOOTING}."classifier_attempts"
    WHERE classifier_code = '99-11'
  `,
  expect: "valid",
});

// --- Classifier histMaxSql ---
cases.push({
  name: "real:classifier.histmax",
  sql: `SELECT COALESCE(NULL::DOUBLE * 1.2, MAX(hit_factor)) AS upper
         FROM ${SHOOTING}."classifier_attempts"
         WHERE classifier_code = '99-11'
           AND division = 'Carry Optics'`,
  expect: "valid",
});

// --- Classifier histSql ---
cases.push({
  name: "real:classifier.hist",
  sql: `
      WITH b AS (
        SELECT hit_factor,
               FLOOR(hit_factor / (12.5 / 20.0)) AS bin_idx
        FROM ${SHOOTING}."classifier_attempts"
        WHERE classifier_code = '99-11'
          AND division = 'Carry Optics'
          AND hit_factor BETWEEN 0 AND 12.5
      )
      SELECT
        (bin_idx * (12.5 / 20.0) + (12.5 / 40.0))::DOUBLE AS bucket_center,
        COUNT(*)::INTEGER AS n
      FROM b
      GROUP BY bin_idx
      ORDER BY bin_idx
  `,
  expect: "valid",
});

// --- Classifier leaderboardSql ---
cases.push({
  name: "real:classifier.leaderboard",
  sql: `
      SELECT
        ca.canonical_id,
        scs.full_name,
        ca.hit_factor,
        ca.national_percentile,
        ca.class,
        CAST(ca.match_date AS VARCHAR) AS match_date,
        ca.match_uuid
      FROM ${SHOOTING}."classifier_attempts" ca
      LEFT JOIN ${SHOOTING}."shooter_canonical_summary" scs
        ON scs.object_id = ca.canonical_id
      WHERE ca.classifier_code = '99-11'
        AND ca.division = 'Carry Optics'
      ORDER BY ca.hit_factor DESC NULLS LAST
      LIMIT 50
  `,
  expect: "valid",
});

// --- Classifier classCountsSql ---
cases.push({
  name: "real:classifier.classcounts",
  sql: `
      SELECT class AS class_letter, COUNT(*)::INTEGER AS n
      FROM ${SHOOTING}."classifier_attempts"
      WHERE classifier_code = '99-11'
        AND division = 'Carry Optics'
        AND class IS NOT NULL AND class != ''
      GROUP BY class
      ORDER BY n DESC
  `,
  expect: "valid",
});

// --- Classifier shooterBestSql ---
cases.push({
  name: "real:classifier.shooterbest",
  sql: `
      SELECT hit_factor, national_percentile, CAST(match_date AS VARCHAR) AS match_date
      FROM ${SHOOTING}."classifier_attempts"
      WHERE classifier_code = '99-11'
        AND division = 'Carry Optics'
        AND canonical_id = '308685'
      ORDER BY hit_factor DESC
      LIMIT 1
  `,
  expect: "valid",
});

// --- Empty/disabled-query placeholder used throughout App.tsx ---
cases.push({ name: "real:placeholder.disabled", sql: "SELECT 1 WHERE FALSE", expect: "valid" });

// ============================================================================
// 2. All allowed lead verbs (>=40 cases)
// ============================================================================
cases.push({ name: "lead:select.basic", sql: "SELECT 1", expect: "valid" });
cases.push({ name: "lead:select.lower", sql: "select 1", expect: "valid" });
cases.push({ name: "lead:select.mixed", sql: "SeLeCt 1", expect: "valid" });
cases.push({ name: "lead:select.upper.full", sql: "SELECT 1, 2, 3", expect: "valid" });
cases.push({ name: "lead:select.lower.full", sql: "select 1, 2, 3", expect: "valid" });
cases.push({ name: "lead:select.from", sql: "SELECT * FROM matches", expect: "valid" });
cases.push({ name: "lead:select.col.alias", sql: "SELECT 1 AS one", expect: "valid" });
cases.push({ name: "lead:select.expr", sql: "SELECT 1 + 2 * 3", expect: "valid" });

cases.push({ name: "lead:with.simple", sql: "WITH a AS (SELECT 1) SELECT * FROM a", expect: "valid" });
cases.push({ name: "lead:with.lower", sql: "with a as (select 1) select * from a", expect: "valid" });
cases.push({ name: "lead:with.mixed", sql: "WiTh a AS (SELECT 1) SELECT * FROM a", expect: "valid" });
cases.push({ name: "lead:with.recursive", sql: "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 10) SELECT * FROM t", expect: "valid" });
cases.push({ name: "lead:with.multiple.ctes", sql: "WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b", expect: "valid" });

cases.push({ name: "lead:show.tables", sql: "SHOW TABLES", expect: "valid" });
cases.push({ name: "lead:show.tables.lower", sql: "show tables", expect: "valid" });
cases.push({ name: "lead:show.databases", sql: "SHOW DATABASES", expect: "valid" });
cases.push({ name: "lead:show.databases.lower", sql: "show databases", expect: "valid" });
cases.push({ name: "lead:show.all.tables", sql: "SHOW ALL TABLES", expect: "valid" });
cases.push({ name: "lead:show.schemas", sql: "SHOW SCHEMAS", expect: "valid" });

cases.push({ name: "lead:describe.table", sql: "DESCRIBE matches", expect: "valid" });
cases.push({ name: "lead:describe.lower", sql: "describe matches", expect: "valid" });
cases.push({ name: "lead:desc.table", sql: "DESC matches", expect: "valid" });
cases.push({ name: "lead:desc.lower", sql: "desc matches", expect: "valid" });
cases.push({ name: "lead:describe.qualified", sql: `DESCRIBE ${SHOOTING}."matches"`, expect: "valid" });

cases.push({ name: "lead:explain.select", sql: "EXPLAIN SELECT 1", expect: "valid" });
cases.push({ name: "lead:explain.lower", sql: "explain select 1", expect: "valid" });
cases.push({ name: "lead:explain.analyze", sql: "EXPLAIN ANALYZE SELECT 1", expect: "valid" });
cases.push({ name: "lead:explain.analyze.lower", sql: "explain analyze select 1", expect: "valid" });

cases.push({ name: "lead:values.basic", sql: "VALUES (1, 2), (3, 4)", expect: "valid" });
cases.push({ name: "lead:values.lower", sql: "values (1, 2)", expect: "valid" });
cases.push({ name: "lead:values.single", sql: "VALUES (1)", expect: "valid" });
cases.push({ name: "lead:values.strings", sql: "VALUES ('a', 'b'), ('c', 'd')", expect: "valid" });

// Leading whitespace variations
cases.push({ name: "lead:whitespace.newline", sql: "\nSELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.newline2", sql: "\n\nSELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.tab", sql: "\tSELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.tab2", sql: "\t\tSELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.spaces", sql: "    SELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.crlf", sql: "\r\nSELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.mixed", sql: "  \n\t  SELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.with.lead", sql: "  \n\tWITH x AS (SELECT 1) SELECT * FROM x", expect: "valid" });
cases.push({ name: "lead:whitespace.show.lead", sql: "\n\n\tSHOW TABLES", expect: "valid" });
cases.push({ name: "lead:whitespace.describe.lead", sql: "\n\nDESC matches", expect: "valid" });
cases.push({ name: "lead:whitespace.explain.lead", sql: "  EXPLAIN SELECT 1", expect: "valid" });
cases.push({ name: "lead:whitespace.values.lead", sql: "\n VALUES (1)", expect: "valid" });

// ============================================================================
// 3. String literals containing forbidden keywords (>=40 cases)
//    All FORBIDDEN tokens, embedded inside single-quoted strings.
// ============================================================================
const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "ATTACH", "DETACH",
  "COPY", "INSTALL", "LOAD", "TRUNCATE", "MERGE", "GRANT", "REVOKE", "VACUUM",
  "CALL", "EXECUTE", "PREPARE", "REPLACE", "UPSERT", "RENAME", "REINDEX",
  "REFRESH", "EXPORT", "IMPORT", "CHECKPOINT", "FORCE", "PRAGMA",
];
for (const kw of FORBIDDEN_KEYWORDS) {
  cases.push({
    name: `string:eq.${kw}`,
    sql: `SELECT 1 WHERE name = '${kw}'`,
    expect: "valid",
  });
  cases.push({
    name: `string:like.pct.${kw}`,
    sql: `SELECT 1 WHERE name ILIKE '%${kw}%'`,
    expect: "valid",
  });
}
// Long descriptions containing keywords
cases.push({
  name: "string:long.description.drop",
  sql: `SELECT 1 WHERE description = 'DROP TABLE - dropping by'`,
  expect: "valid",
});
cases.push({
  name: "string:long.description.grant",
  sql: `SELECT 1 WHERE description = 'GRANT-style search query'`,
  expect: "valid",
});
cases.push({
  name: "string:semicolons.in.literal",
  sql: `SELECT 1 WHERE comment = 'a; b; c'`,
  expect: "valid",
});
cases.push({
  name: "string:multistmt.lookalike",
  sql: `SELECT 1 WHERE comment = 'SELECT 1; SELECT 2; SELECT 3'`,
  expect: "valid",
});
cases.push({
  name: "string:semicolons.complex",
  sql: `SELECT name FROM matches WHERE notes = 'event;reschedule;canceled'`,
  expect: "valid",
});
cases.push({
  name: "string:semis.with.in.list",
  sql: `SELECT * FROM matches WHERE state IN ('A;Z', 'C;A')`,
  expect: "valid",
});
cases.push({
  name: "string:two.forbidden.in.literal",
  sql: `SELECT 1 WHERE notes = 'DROP and CREATE not allowed'`,
  expect: "valid",
});
cases.push({
  name: "string:concat.forbidden",
  sql: `SELECT 1 WHERE notes = 'INSERT' || ' INTO ' || 'TARGET'`,
  expect: "valid",
});
cases.push({
  name: "string:where.shooter.name.dq",
  sql: `SELECT * FROM ${SHOOTING}."match_results" WHERE shooter_name = 'O Brien' AND dq_reason = 'GRANT level violation'`,
  expect: "valid",
});

// ============================================================================
// 4. Single-quote escapes (>=20 cases)
// ============================================================================
cases.push({ name: "escape:obrien", sql: "SELECT 'O''Brien'", expect: "valid" });
cases.push({ name: "escape:its.a.select", sql: "SELECT 'It''s a SELECT'", expect: "valid" });
cases.push({ name: "escape:double.quote", sql: "SELECT '''hello'''", expect: "valid" });
cases.push({ name: "escape:in.like", sql: "SELECT 1 WHERE name LIKE '%''%'", expect: "valid" });
cases.push({ name: "escape:multiple", sql: "SELECT 'don''t', 'won''t', 'can''t'", expect: "valid" });
cases.push({ name: "escape:obrien.from", sql: `SELECT * FROM ${SHOOTING}."shooters" WHERE full_name = 'O''Brien'`, expect: "valid" });
cases.push({ name: "escape:with.forbidden", sql: "SELECT 'don''t DROP it'", expect: "valid" });
cases.push({ name: "escape:semicolon.escaped", sql: "SELECT 'a; b''c; d'", expect: "valid" });
cases.push({ name: "escape:adjacent.empty", sql: "SELECT '', '', ''", expect: "valid" });
cases.push({ name: "escape:in.like.both", sql: "SELECT 1 WHERE name LIKE '%''Brien%'", expect: "valid" });
cases.push({ name: "escape:apostrophe.heavy", sql: "SELECT 'It''s O''Brien''s match'", expect: "valid" });
cases.push({ name: "escape:concat.escapes", sql: "SELECT 'a' || '''' || 'b'", expect: "valid" });
cases.push({ name: "escape:where.id.escaped", sql: "SELECT * FROM matches WHERE id = 'O''Brien-2026'", expect: "valid" });
cases.push({ name: "escape:union.escaped", sql: "SELECT 'a' UNION SELECT 'don''t'", expect: "valid" });
cases.push({ name: "escape:case.expr", sql: "SELECT CASE WHEN x = 'a''b' THEN 'c''d' ELSE 'e''f' END FROM t", expect: "valid" });
cases.push({ name: "escape:one.then.kw", sql: "SELECT 'O''Brien' WHERE 1 = 1", expect: "valid" });
cases.push({ name: "escape:doubled.escape", sql: "SELECT 'a''''b'", expect: "valid" });
cases.push({ name: "escape:forbidden.with.escape", sql: "SELECT 'INSERT''ALTER''DROP'", expect: "valid" });
cases.push({ name: "escape:trailing.empty", sql: "SELECT 'O''Brien' || ''", expect: "valid" });
cases.push({ name: "escape:with.unicode", sql: "SELECT 'Ñoño''s'", expect: "valid" });

// ============================================================================
// 5. Double-quoted identifiers (>=20 cases)
// ============================================================================
cases.push({ name: "ident:spaces", sql: 'SELECT * FROM "match results"', expect: "valid" });
cases.push({ name: "ident:reserved.drop", sql: 'SELECT "DROP".x FROM "y"', expect: "valid" });
cases.push({ name: "ident:reserved.insert", sql: 'SELECT "INSERT" FROM x', expect: "valid" });
cases.push({ name: "ident:reserved.delete", sql: 'SELECT "DELETE" FROM x', expect: "valid" });
cases.push({ name: "ident:reserved.merge", sql: 'SELECT "MERGE" FROM x', expect: "valid" });
cases.push({ name: "ident:reserved.create", sql: 'SELECT "CREATE" FROM x', expect: "valid" });
cases.push({ name: "ident:reserved.alter", sql: 'SELECT "ALTER" FROM x', expect: "valid" });
cases.push({ name: "ident:reserved.attach", sql: 'SELECT "ATTACH" FROM x', expect: "valid" });
cases.push({ name: "ident:reserved.copy", sql: 'SELECT "COPY" FROM x', expect: "valid" });
cases.push({ name: "ident:reserved.pragma", sql: 'SELECT "PRAGMA" FROM x', expect: "valid" });
cases.push({ name: "ident:doubled.quotes", sql: 'SELECT "weird ""quoted"" id" FROM x', expect: "valid" });
cases.push({ name: "ident:doubled.with.kw", sql: 'SELECT "DROP ""TABLE"" foo" FROM x', expect: "valid" });
cases.push({ name: "ident:fq", sql: 'SELECT "app"."main"."matches".match_uuid FROM "app"."main"."matches"', expect: "valid" });
cases.push({ name: "ident:case.preserved", sql: 'SELECT "CamelCase", "lowercase", "UPPER" FROM "Some Table"', expect: "valid" });
cases.push({ name: "ident:special.chars", sql: 'SELECT "col-with-dash", "col.with.dot" FROM x', expect: "valid" });
cases.push({ name: "ident:semicolon.in.id", sql: 'SELECT "col;with;semi" FROM "tbl;name"', expect: "valid" });
cases.push({ name: "ident:multiple.reserved", sql: 'SELECT "DROP", "CREATE", "ALTER" FROM "t"', expect: "valid" });
cases.push({ name: "ident:reserved.alias", sql: 'SELECT col AS "DROP" FROM x', expect: "valid" });
cases.push({ name: "ident:fq.with.kw", sql: `SELECT m.match_uuid FROM ${SHOOTING}."matches" m WHERE m."ALTER" = 1`, expect: "valid" });
cases.push({ name: "ident:long.id", sql: 'SELECT "this is a very long quoted identifier with spaces and DROP TABLE inside" FROM x', expect: "valid" });
cases.push({ name: "ident:column.from.subquery", sql: 'SELECT "RENAMED" FROM (SELECT col AS "RENAMED" FROM matches)', expect: "valid" });

// ============================================================================
// 6. Comment styles (>=20 cases)
// ============================================================================
cases.push({ name: "comment:line.before", sql: "-- comment\nSELECT 1", expect: "valid" });
cases.push({ name: "comment:line.before.multi", sql: "-- a\n-- b\n-- c\nSELECT 1", expect: "valid" });
cases.push({ name: "comment:block.before", sql: "/* hi */ SELECT 1", expect: "valid" });
cases.push({ name: "comment:block.multiline.before", sql: "/* multi\nline\ncomment */ SELECT 1", expect: "valid" });
cases.push({ name: "comment:line.trailing", sql: "SELECT 1 -- trailing", expect: "valid" });
cases.push({ name: "comment:line.trailing.semi", sql: "SELECT 1; -- trailing comment", expect: "valid" });
cases.push({ name: "comment:block.mid", sql: "SELECT /* mid */ 1", expect: "valid" });
cases.push({ name: "comment:line.with.forbidden", sql: "-- DROP TABLE foo\nSELECT 1", expect: "valid" });
cases.push({ name: "comment:block.with.forbidden", sql: "/* CREATE INDEX hint */ SELECT 1", expect: "valid" });
cases.push({ name: "comment:cache.bust.refresh", sql: "/* v=42 */ SELECT * FROM matches", expect: "valid" });
cases.push({ name: "comment:line.with.semi", sql: "-- ; ; ;\nSELECT 1", expect: "valid" });
cases.push({ name: "comment:block.with.semi", sql: "/* a; b; c; */ SELECT 1", expect: "valid" });
cases.push({ name: "comment:nested.style", sql: "/* outer */ SELECT 1 /* inner */ FROM matches /* tail */", expect: "valid" });
cases.push({ name: "comment:line.lots", sql: "-- 1\n-- 2\n-- 3\n-- 4\n-- 5\nSELECT 1", expect: "valid" });
cases.push({ name: "comment:line.tab.lead", sql: "\t-- tab-led comment\n\tSELECT 1", expect: "valid" });
cases.push({ name: "comment:in.cte", sql: "WITH a AS ( -- inner\n  SELECT 1\n) SELECT * FROM a", expect: "valid" });
cases.push({ name: "comment:multiple.blocks", sql: "/* 1 */ /* 2 */ /* 3 */ SELECT 1", expect: "valid" });
cases.push({ name: "comment:block.before.with", sql: "/* setup */ WITH a AS (SELECT 1) SELECT * FROM a", expect: "valid" });
cases.push({ name: "comment:full.line.then.show", sql: "-- comment line\nSHOW TABLES", expect: "valid" });
cases.push({ name: "comment:block.then.explain", sql: "/* check plan */ EXPLAIN SELECT 1", expect: "valid" });
cases.push({ name: "comment:double.dash.in.string", sql: "SELECT 'a -- b'", expect: "valid" });
cases.push({ name: "comment:slash.star.in.string", sql: "SELECT 'a /* b */ c'", expect: "valid" });

// ============================================================================
// 7. Trailing semicolon (>=10 cases)
// ============================================================================
cases.push({ name: "semi:bare", sql: "SELECT 1;", expect: "valid" });
cases.push({ name: "semi:space.before", sql: "SELECT 1 ;", expect: "valid" });
cases.push({ name: "semi:newline.after", sql: "SELECT 1;\n", expect: "valid" });
cases.push({ name: "semi:trailing.spaces", sql: "SELECT 1;   ", expect: "valid" });
cases.push({ name: "semi:trailing.tabs", sql: "SELECT 1;\t\t", expect: "valid" });
cases.push({ name: "semi:trailing.crlf", sql: "SELECT 1;\r\n", expect: "valid" });
cases.push({ name: "semi:after.alias", sql: "SELECT 1 AS one;", expect: "valid" });
cases.push({ name: "semi:after.cte", sql: "WITH a AS (SELECT 1) SELECT * FROM a;", expect: "valid" });
cases.push({ name: "semi:after.show", sql: "SHOW TABLES;", expect: "valid" });
cases.push({ name: "semi:after.describe", sql: "DESCRIBE matches;", expect: "valid" });
cases.push({ name: "semi:after.explain", sql: "EXPLAIN SELECT 1;", expect: "valid" });
cases.push({ name: "semi:after.values", sql: "VALUES (1);", expect: "valid" });

// ============================================================================
// 8. CTEs and complex SELECTs (>=30 cases)
// ============================================================================
cases.push({ name: "cte:two.simple", sql: "WITH a AS (SELECT 1), b AS (SELECT 2 FROM a) SELECT * FROM b", expect: "valid" });
cases.push({ name: "cte:three", sql: "WITH a AS (SELECT 1 AS x), b AS (SELECT x*2 AS y FROM a), c AS (SELECT y+1 FROM b) SELECT * FROM c", expect: "valid" });
cases.push({ name: "cte:recursive.fib", sql: "WITH RECURSIVE fib(n, a, b) AS (SELECT 0, 0, 1 UNION ALL SELECT n+1, b, a+b FROM fib WHERE n < 10) SELECT a FROM fib", expect: "valid" });
cases.push({ name: "cte:windowed", sql: "SELECT name, row_number() OVER (PARTITION BY state ORDER BY match_date DESC) AS rn FROM matches", expect: "valid" });
cases.push({ name: "cte:window.named", sql: "SELECT name, row_number() OVER w FROM matches WINDOW w AS (PARTITION BY state ORDER BY match_date)", expect: "valid" });
cases.push({ name: "cte:agg.having", sql: "SELECT state, COUNT(*) AS n FROM matches GROUP BY state HAVING COUNT(*) > 5", expect: "valid" });
cases.push({ name: "cte:union.all", sql: "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3", expect: "valid" });
cases.push({ name: "cte:union.distinct", sql: "SELECT 1 UNION SELECT 2", expect: "valid" });
cases.push({ name: "cte:intersect", sql: "SELECT 1 INTERSECT SELECT 1", expect: "valid" });
cases.push({ name: "cte:except", sql: "SELECT 1 EXCEPT SELECT 2", expect: "valid" });
cases.push({ name: "cte:join.inner", sql: "SELECT a.* FROM a INNER JOIN b ON a.id = b.id", expect: "valid" });
cases.push({ name: "cte:join.left", sql: "SELECT a.* FROM a LEFT JOIN b ON a.id = b.id", expect: "valid" });
cases.push({ name: "cte:join.right", sql: "SELECT a.* FROM a RIGHT JOIN b ON a.id = b.id", expect: "valid" });
cases.push({ name: "cte:join.full", sql: "SELECT a.* FROM a FULL JOIN b ON a.id = b.id", expect: "valid" });
cases.push({ name: "cte:join.full.outer", sql: "SELECT a.* FROM a FULL OUTER JOIN b ON a.id = b.id", expect: "valid" });
cases.push({ name: "cte:join.cross", sql: "SELECT a.*, b.* FROM a CROSS JOIN b", expect: "valid" });
cases.push({ name: "cte:join.using", sql: "SELECT * FROM a JOIN b USING (match_uuid)", expect: "valid" });
cases.push({ name: "cte:subquery.in.select", sql: "SELECT (SELECT MAX(id) FROM b) AS m FROM a", expect: "valid" });
cases.push({ name: "cte:subquery.in.from", sql: "SELECT * FROM (SELECT 1 AS x) sq", expect: "valid" });
cases.push({ name: "cte:correlated.subq", sql: "SELECT a.id, (SELECT b.name FROM b WHERE b.a_id = a.id) FROM a", expect: "valid" });
cases.push({ name: "cte:exists", sql: "SELECT 1 WHERE EXISTS (SELECT 1 FROM matches WHERE state = 'AZ')", expect: "valid" });
cases.push({ name: "cte:not.exists", sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM matches)", expect: "valid" });
cases.push({ name: "cte:in.subq", sql: "SELECT * FROM matches WHERE id IN (SELECT id FROM upcoming_matches)", expect: "valid" });
cases.push({ name: "cte:not.in.subq", sql: "SELECT * FROM matches WHERE id NOT IN (SELECT id FROM upcoming_matches)", expect: "valid" });
cases.push({ name: "cte:case.when", sql: "SELECT CASE WHEN x > 10 THEN 'big' WHEN x > 5 THEN 'mid' ELSE 'small' END FROM t", expect: "valid" });
cases.push({ name: "cte:cast.types", sql: "SELECT CAST(x AS INTEGER), CAST(y AS VARCHAR), CAST(z AS DOUBLE) FROM t", expect: "valid" });
cases.push({ name: "cte:order.limit.offset", sql: "SELECT * FROM matches ORDER BY match_date DESC LIMIT 10 OFFSET 20", expect: "valid" });
cases.push({ name: "cte:agg.functions", sql: "SELECT COUNT(*), SUM(n), AVG(p), MIN(d), MAX(d), STDDEV(x) FROM t", expect: "valid" });
cases.push({ name: "cte:string.functions", sql: "SELECT LOWER(name), UPPER(name), LENGTH(name), TRIM(name) FROM t", expect: "valid" });
cases.push({ name: "cte:date.functions", sql: "SELECT DATE_TRUNC('month', match_date), EXTRACT(YEAR FROM match_date) FROM matches", expect: "valid" });
cases.push({ name: "cte:bool.ops", sql: "SELECT * FROM matches WHERE state = 'AZ' AND match_type = 'uspsa' OR state = 'CA'", expect: "valid" });
cases.push({ name: "cte:between", sql: "SELECT * FROM matches WHERE match_date BETWEEN '2025-01-01' AND '2025-12-31'", expect: "valid" });
cases.push({ name: "cte:not.between", sql: "SELECT * FROM matches WHERE n NOT BETWEEN 1 AND 10", expect: "valid" });
cases.push({ name: "cte:list.containers", sql: "SELECT [1,2,3] AS lst, {'a': 1, 'b': 2} AS strct", expect: "valid" });
cases.push({ name: "cte:json.path", sql: "SELECT data->>'name' FROM matches", expect: "valid" });

// ============================================================================
// 9. DuckDB-flavor SELECTs (>=20 cases)
// ============================================================================
cases.push({ name: "duck:select.star", sql: "SELECT * FROM matches", expect: "valid" });
cases.push({ name: "duck:select.exclude", sql: "SELECT * EXCLUDE (sensitive_col) FROM matches", expect: "valid" });
cases.push({ name: "duck:select.exclude.list", sql: "SELECT * EXCLUDE (a, b, c) FROM matches", expect: "valid" });
cases.push({ name: "duck:qualify", sql: "SELECT * FROM matches QUALIFY ROW_NUMBER() OVER (PARTITION BY state ORDER BY match_date) = 1", expect: "valid" });
cases.push({ name: "duck:group.all", sql: "SELECT category, SUM(n) FROM t GROUP BY ALL", expect: "valid" });
cases.push({ name: "duck:order.all", sql: "SELECT * FROM matches ORDER BY ALL", expect: "valid" });
cases.push({ name: "duck:union.by.name", sql: "SELECT a, b FROM x UNION BY NAME SELECT b, a FROM y", expect: "valid" });
cases.push({ name: "duck:cast.shorthand", sql: "SELECT 1::DOUBLE AS d, '2025-01-01'::DATE AS dt", expect: "valid" });
cases.push({ name: "duck:list.lambda", sql: "SELECT list_filter([1,2,3,4], x -> x > 2)", expect: "valid" });
cases.push({ name: "duck:list.transform", sql: "SELECT list_transform([1,2,3], x -> x * 2)", expect: "valid" });
cases.push({ name: "duck:list.access", sql: "SELECT [1,2,3][1] AS first_val", expect: "valid" });
cases.push({ name: "duck:struct.access", sql: "SELECT {'a': 1, 'b': 'text'}.a AS field_a", expect: "valid" });
cases.push({ name: "duck:struct.brackets", sql: "SELECT {'a': 1}['a'] AS a", expect: "valid" });
cases.push({ name: "duck:unnest", sql: "SELECT UNNEST([1,2,3]) AS n", expect: "valid" });
cases.push({ name: "duck:columns.regex", sql: `SELECT COLUMNS('sales_.*') FROM sales`, expect: "valid" });
cases.push({ name: "duck:columns.transform", sql: `SELECT AVG(COLUMNS('sales_.*')) FROM sales`, expect: "valid" });
cases.push({ name: "duck:select.no.from", sql: "SELECT 1 + 1 AS result", expect: "valid" });
cases.push({ name: "duck:lateral.subq", sql: "SELECT a.id, sq.* FROM a, LATERAL (SELECT * FROM b WHERE b.id = a.id) sq", expect: "valid" });
cases.push({ name: "duck:asof.join", sql: "SELECT * FROM a ASOF JOIN b ON a.t >= b.t", expect: "valid" });
cases.push({ name: "duck:positional.refs", sql: "SELECT a, b FROM t ORDER BY 1 DESC, 2 ASC", expect: "valid" });
cases.push({ name: "duck:nullif", sql: "SELECT NULLIF(x, 0) AS y FROM t", expect: "valid" });
cases.push({ name: "duck:coalesce.many", sql: "SELECT COALESCE(a, b, c, d, e, 'default') FROM t", expect: "valid" });
cases.push({ name: "duck:filter.agg", sql: "SELECT COUNT(*) FILTER (WHERE state = 'AZ') AS az_n FROM matches", expect: "valid" });

// REPLACE — DuckDB column-projection form. Bare REPLACE was removed from
// FORBIDDEN; the write form REPLACE INTO is caught by REPLACE_WRITE.
cases.push({
  name: "duck:select.replace.star",
  sql: "SELECT * REPLACE (UPPER(name) AS name) FROM matches",
  expect: "valid",
});
cases.push({
  name: "duck:select.replace.multi",
  sql: "SELECT * REPLACE (UPPER(name) AS name, lower(club) AS club) FROM matches",
  expect: "valid",
});
cases.push({
  name: "duck:cte.replace.projection",
  sql: "WITH m AS (SELECT * REPLACE (TRIM(name) AS name) FROM matches) SELECT count(*) FROM m",
  expect: "valid",
});

// ============================================================================
// 10. Long but valid queries (>=10 cases)
// ============================================================================
function makeLongQuery(targetBytes) {
  // Generates a syntactically-valid SELECT with a WHERE-IN list of dummy
  // string literals padded out to ~targetBytes total length. None of the
  // padding contains forbidden keywords or semicolons.
  const head = "SELECT match_uuid, shooter_id, shooter_name FROM matches WHERE shooter_id IN (";
  const tail = ") ORDER BY match_uuid";
  const piece = "'mmShooter_ABCDEFGHIJ',";
  const need = Math.max(0, targetBytes - head.length - tail.length);
  const reps = Math.max(1, Math.floor(need / piece.length));
  const body = piece.repeat(reps);
  // Strip the trailing comma so we have a valid IN list.
  const trimmed = body.replace(/,$/, "");
  return head + trimmed + tail;
}
cases.push({ name: "long:1k",     sql: makeLongQuery(1024),    expect: "valid" });
cases.push({ name: "long:2k",     sql: makeLongQuery(2 * 1024), expect: "valid" });
cases.push({ name: "long:3k",     sql: makeLongQuery(3 * 1024), expect: "valid" });
cases.push({ name: "long:4k",     sql: makeLongQuery(4 * 1024), expect: "valid" });
cases.push({ name: "long:5k",     sql: makeLongQuery(5 * 1024), expect: "valid" });
cases.push({ name: "long:7k",     sql: makeLongQuery(7 * 1024), expect: "valid" });
cases.push({ name: "long:10k",    sql: makeLongQuery(10 * 1024), expect: "valid" });
cases.push({ name: "long:12k",    sql: makeLongQuery(12 * 1024), expect: "valid" });
cases.push({ name: "long:14k",    sql: makeLongQuery(14 * 1024), expect: "valid" });
cases.push({ name: "long:15k",    sql: makeLongQuery(15 * 1024), expect: "valid" });
cases.push({ name: "long:15.5k",  sql: makeLongQuery(15500),     expect: "valid" });
cases.push({ name: "long:15.9k",  sql: makeLongQuery(15900),     expect: "valid" });

// ============================================================================
// 11. Whitespace and casing oddities (>=20 cases)
// ============================================================================
cases.push({ name: "ws:upper", sql: "SELECT 1 FROM MATCHES WHERE STATE = 'AZ'", expect: "valid" });
cases.push({ name: "ws:lower", sql: "select 1 from matches where state = 'AZ'", expect: "valid" });
cases.push({ name: "ws:title", sql: "Select 1 From Matches Where State = 'AZ'", expect: "valid" });
cases.push({ name: "ws:weird.case", sql: "sElEcT 1 fRoM mAtChEs", expect: "valid" });
cases.push({ name: "ws:internal.tabs", sql: "SELECT\t1\tFROM\tmatches", expect: "valid" });
cases.push({ name: "ws:internal.newlines", sql: "SELECT\n1\nFROM\nmatches", expect: "valid" });
cases.push({ name: "ws:lots.of.spaces", sql: "SELECT     1     FROM     matches", expect: "valid" });
cases.push({ name: "ws:leading.crlf.tab", sql: "\r\n\tSELECT 1", expect: "valid" });
cases.push({ name: "ws:wide.indent", sql: "       SELECT 1", expect: "valid" });
cases.push({ name: "ws:trailing.spaces", sql: "SELECT 1     ", expect: "valid" });
cases.push({ name: "ws:trailing.newline", sql: "SELECT 1\n", expect: "valid" });
cases.push({ name: "ws:trailing.lots.newlines", sql: "SELECT 1\n\n\n", expect: "valid" });
cases.push({ name: "ws:internal.crlf", sql: "SELECT 1\r\nFROM matches", expect: "valid" });
cases.push({ name: "ws:mixed.indent", sql: "  \t SELECT\n  \t  1\n  \t FROM matches", expect: "valid" });
cases.push({ name: "ws:case.with.cte.lower", sql: "with x as (select 1) select * from x", expect: "valid" });
cases.push({ name: "ws:case.with.cte.upper", sql: "WITH X AS (SELECT 1) SELECT * FROM X", expect: "valid" });
cases.push({ name: "ws:tabs.between.tokens", sql: "SELECT\t*\tFROM\tmatches\tWHERE\tstate\t=\t'AZ'", expect: "valid" });
cases.push({ name: "ws:case.show", sql: "ShOw TaBlEs", expect: "valid" });
cases.push({ name: "ws:case.describe", sql: "dEsCrIbE matches", expect: "valid" });
cases.push({ name: "ws:case.explain", sql: "ExPlAiN AnAlYzE SeLeCt 1", expect: "valid" });
cases.push({ name: "ws:newline.between.cte.parts", sql: "WITH\n  a AS (\n    SELECT 1\n  )\nSELECT * FROM a", expect: "valid" });
cases.push({ name: "ws:case.from.with.fq", sql: `SELECT * FROM ${SHOOTING}."matches" WHERE state = 'az'`, expect: "valid" });

// ============================================================================
// 12. Extra coverage: realistic small SELECTs the dashboard might emit
// ============================================================================
cases.push({ name: "extra:cast.timestamp", sql: "SELECT CAST(first_seen_at AS VARCHAR) AS t FROM matches", expect: "valid" });
cases.push({ name: "extra:filter.in.list", sql: "SELECT * FROM matches WHERE state IN ('AZ','CA','TX','NV')", expect: "valid" });
cases.push({ name: "extra:filter.is.null", sql: "SELECT * FROM matches WHERE club IS NULL", expect: "valid" });
cases.push({ name: "extra:filter.is.not.null", sql: "SELECT * FROM matches WHERE club IS NOT NULL", expect: "valid" });
cases.push({ name: "extra:limit.0", sql: "SELECT * FROM matches LIMIT 0", expect: "valid" });
cases.push({ name: "extra:select.distinct", sql: "SELECT DISTINCT state FROM matches", expect: "valid" });
cases.push({ name: "extra:select.distinct.on", sql: "SELECT DISTINCT ON (state) state, match_date FROM matches", expect: "valid" });
cases.push({ name: "extra:order.nulls.first", sql: "SELECT * FROM matches ORDER BY club ASC NULLS FIRST", expect: "valid" });
cases.push({ name: "extra:order.nulls.last", sql: "SELECT * FROM matches ORDER BY club ASC NULLS LAST", expect: "valid" });
cases.push({ name: "extra:count.distinct", sql: "SELECT COUNT(DISTINCT shooter_id) FROM match_results", expect: "valid" });
cases.push({ name: "extra:over.empty", sql: "SELECT SUM(n) OVER () FROM t", expect: "valid" });
cases.push({ name: "extra:window.range", sql: "SELECT SUM(n) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) FROM t", expect: "valid" });
cases.push({ name: "extra:current.date", sql: "SELECT CURRENT_DATE", expect: "valid" });
cases.push({ name: "extra:current.timestamp", sql: "SELECT CURRENT_TIMESTAMP", expect: "valid" });
cases.push({ name: "extra:interval", sql: "SELECT CURRENT_DATE - INTERVAL 7 DAY", expect: "valid" });
cases.push({ name: "extra:cast.varchar.array", sql: "SELECT NULL::VARCHAR[] AS arr", expect: "valid" });
cases.push({ name: "extra:cte.with.cast", sql: "WITH a AS (SELECT 1::DOUBLE AS x) SELECT * FROM a", expect: "valid" });
cases.push({ name: "extra:where.false", sql: "SELECT 1 WHERE FALSE", expect: "valid" });
cases.push({ name: "extra:where.true", sql: "SELECT 1 WHERE TRUE", expect: "valid" });
cases.push({ name: "extra:scalar.subq.in.select", sql: "SELECT (SELECT 1) AS one", expect: "valid" });

// More forbidden-keyword-as-string-content edges
cases.push({ name: "extra:str.kw.with.kw", sql: "SELECT 'INSERT INTO bar VALUES (1)' AS notes", expect: "valid" });
cases.push({ name: "extra:str.kw.escape", sql: "SELECT 'don''t DROP that ALTER and CREATE' AS msg", expect: "valid" });
cases.push({ name: "extra:str.long.with.kw", sql: "SELECT 'this is a long string with INSERT, UPDATE, DELETE, MERGE, REPLACE, CALL, EXECUTE, PREPARE words' AS msg", expect: "valid" });
cases.push({ name: "extra:union.with.where", sql: "SELECT 1 WHERE 1 = 1 UNION ALL SELECT 2 WHERE 2 = 2", expect: "valid" });
cases.push({ name: "extra:multi.cte.complex", sql: "WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS x), c AS (SELECT * FROM a UNION ALL SELECT * FROM b) SELECT * FROM c ORDER BY 1", expect: "valid" });

// More identifier edge cases
cases.push({ name: "extra:id.unicode", sql: 'SELECT "résumé", "naïve" FROM "übertable"', expect: "valid" });
cases.push({ name: "extra:id.numeric.col", sql: 'SELECT t."123abc" FROM t', expect: "valid" });
cases.push({ name: "extra:fq.three.parts.no.quotes", sql: "SELECT * FROM shooting.main.matches", expect: "valid" });
cases.push({ name: "extra:fq.three.parts.alias", sql: "SELECT m.* FROM shooting.main.matches m", expect: "valid" });

// More CTEs and aggregate
cases.push({ name: "extra:cte.recursive.long", sql: "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 100) SELECT COUNT(*) FROM t", expect: "valid" });
cases.push({ name: "extra:agg.string", sql: "SELECT STRING_AGG(name, ', ') FROM matches", expect: "valid" });
cases.push({ name: "extra:agg.array", sql: "SELECT ARRAY_AGG(name) FROM matches", expect: "valid" });
cases.push({ name: "extra:agg.list", sql: "SELECT LIST(name) FROM matches", expect: "valid" });

// More date/time
cases.push({ name: "extra:date.add", sql: "SELECT match_date + INTERVAL 7 DAY FROM matches", expect: "valid" });
cases.push({ name: "extra:date.subtract", sql: "SELECT match_date - INTERVAL '1 month' FROM matches", expect: "valid" });
cases.push({ name: "extra:strftime", sql: "SELECT strftime(match_date, '%Y-%m-%d') FROM matches", expect: "valid" });

// More random syntactic forms
cases.push({ name: "extra:case.no.else", sql: "SELECT CASE WHEN x = 1 THEN 'a' END FROM t", expect: "valid" });
cases.push({ name: "extra:multi.col.expr", sql: "SELECT a + b * c - d / e AS computed FROM t", expect: "valid" });
cases.push({ name: "extra:bitwise.ops", sql: "SELECT a & b, a | b, a # b, a >> 2, a << 3 FROM t", expect: "valid" });
cases.push({ name: "extra:nested.subq", sql: "SELECT * FROM (SELECT * FROM (SELECT * FROM matches) x) y", expect: "valid" });
cases.push({ name: "extra:select.no.space.semi", sql: "SELECT 1;", expect: "valid" });
cases.push({ name: "extra:single.line.long.cte", sql: "WITH a AS (SELECT 1 AS x), b AS (SELECT x*2 AS y FROM a), c AS (SELECT y+10 AS z FROM b), d AS (SELECT z*z AS sq FROM c) SELECT * FROM d", expect: "valid" });

// More comment edge cases
cases.push({ name: "comment:line.no.newline", sql: "SELECT 1 -- end of file no newline", expect: "valid" });
cases.push({ name: "comment:block.empty", sql: "/**/ SELECT 1", expect: "valid" });
cases.push({ name: "comment:block.only.spaces", sql: "/*   */ SELECT 1", expect: "valid" });
cases.push({ name: "comment:line.empty", sql: "--\nSELECT 1", expect: "valid" });

// String literal edges
cases.push({ name: "string:empty", sql: "SELECT ''", expect: "valid" });
cases.push({ name: "string:only.escaped.quotes", sql: "SELECT ''''", expect: "valid" });
cases.push({ name: "string:only.escaped.quotes.long", sql: "SELECT ''''''''''", expect: "valid" });
cases.push({ name: "string:semis.only", sql: "SELECT ';;;;;'", expect: "valid" });
cases.push({ name: "string:asterisks", sql: "SELECT '/* not a comment */'", expect: "valid" });
cases.push({ name: "string:dashes", sql: "SELECT '-- not a comment'", expect: "valid" });

// Mixed
cases.push({
  name: "mixed:cte.comments.escapes",
  sql: `
    /* outer comment */
    WITH a AS ( -- inner
      SELECT 'O''Brien' AS name, 1 AS id
    )
    SELECT * FROM a /* tail */
  `,
  expect: "valid",
});
cases.push({
  name: "mixed:long.real.cte.with.literal.semis",
  sql: `
    WITH base AS (
      SELECT match_uuid, match_name, club, state
      FROM ${SHOOTING}."matches"
      WHERE notes = 'a; b; c; d;'
    )
    SELECT * FROM base ORDER BY match_uuid
  `,
  expect: "valid",
});
cases.push({
  name: "mixed:explain.cte",
  sql: "EXPLAIN WITH a AS (SELECT 1) SELECT * FROM a",
  expect: "valid",
});
cases.push({
  name: "mixed:explain.analyze.complex",
  sql: "EXPLAIN ANALYZE SELECT m.* FROM matches m JOIN match_results mr USING (match_uuid) WHERE m.state = 'AZ' LIMIT 10",
  expect: "valid",
});

// ============================================================================
// Run and report.
// ============================================================================
const result = runValidatorCases(cases);

console.log("Total :", result.total);
console.log("Pass  :", result.pass);
console.log("Fail  :", result.fail);
console.log("");

if (result.fail > 0) {
  console.log("First 10 failures:");
  for (const f of result.failures.slice(0, 10)) {
    console.log("---");
    console.log("name:    ", f.name);
    console.log("expected:", JSON.stringify(f.expected));
    console.log("got:     ", JSON.stringify(f.got));
    const oneLine = String(f.sql).replace(/\s+/g, " ").trim();
    console.log("sql:     ", oneLine.length > 240 ? oneLine.slice(0, 240) + "…" : oneLine);
  }
  process.exit(1);
}

console.log("All valid-query cases passed.");
