//! Private scheduled bot roster and observation replay. This module has no HTTP ingestion entrypoint.
use crate::{
    bot_simulation::{self as policy, Persona},
    support::{Failure, blob, now, number, random, statement, text, uuid},
};
use chrono::{Datelike, NaiveDate};
use folding_domain::{
    reducer,
    wire::{Event, Generation, Id, Transition},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use worker::*;

const BATCH_BOTS: usize = 10;
/// Sequence space per bot per UTC day (open+close events). Heavy seeded bots plan at most 26 pairs,
/// so one write always covers a bot's whole day and a single pass completes past days.
const DAY_EVENTS: usize = 64;

#[derive(Deserialize)]
struct State {
    watermark_ms: i64,
    revision: i64,
    cursor_participant_id: Option<String>,
    launch_started_at_ms: Option<i64>,
}
#[derive(Deserialize)]
struct Bot {
    participant_id: String,
    persona_id: String,
    persona_version: i64,
    seed: Vec<u8>,
    joined_at_ms: i64,
    device_id: String,
    epoch_id: String,
    generation_id: String,
}
fn id(seed: &[u8], scope: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b"folding.bot.id.v1\0");
    h.update(seed);
    h.update(scope);
    let d = h.finalize();
    let hex = crate::assertion::hex(&d[..16]);
    format!(
        "{}-{}-4{}-a{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[13..16],
        &hex[17..20],
        &hex[20..32]
    )
}
fn event_id(bot: &Bot, day: i64, seq: u64) -> Id {
    Id::parse(&id(
        bot.participant_id.as_bytes(),
        format!("{day}:{seq}").as_bytes(),
    ))
    .unwrap()
}

async fn create_roster(env: &Env, db: &D1Database, time: i64) -> Result<(), Failure> {
    #[derive(Deserialize)]
    struct Count {
        count: i64,
    }
    #[derive(Deserialize)]
    struct Started {
        launch_started_at_ms: Option<i64>,
    }
    let started = statement(
        db,
        "SELECT launch_started_at_ms FROM bot_simulation_state WHERE singleton=1",
        &[],
    )?
    .first::<Started>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or_else(Failure::unavailable)?
    .launch_started_at_ms;
    let launch = started.unwrap_or(time);
    if started.is_none() {
        statement(db,"UPDATE bot_simulation_state SET launch_started_at_ms=?1 WHERE singleton=1 AND launch_started_at_ms IS NULL",&[number(launch)])?.run().await.map_err(|_|Failure::conflict())?;
    }
    let count = statement(db, "SELECT count(*) AS count FROM bot_profiles", &[])?
        .first::<Count>(None)
        .await
        .map_err(|_| Failure::unavailable())?
        .ok_or_else(Failure::unavailable)?
        .count
        .max(0) as usize;
    let weeks = ((time - launch).max(0) / 604800000) as usize;
    let desired =
        (policy::LAUNCH_BOT_COUNT + weeks * policy::WEEKLY_JOIN_COUNT).min(policy::MAX_BOT_COUNT);
    if count >= desired {
        return Ok(());
    }
    let bucket = env.bucket("AVATARS").map_err(|_| Failure::unavailable())?;
    let mut photo_index = statement(
        db,
        "SELECT count(*) AS count FROM bot_profiles WHERE avatar_style='photo'",
        &[],
    )?
    .first::<Count>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .map_or(0, |c| c.count.max(0) as usize);
    let mut writes = vec![];
    for ordinal in count..desired {
        let seed = random::<32>()?;
        let p = &policy::seeded_persona(&seed);
        let participant = uuid()?;
        let device = uuid()?;
        let epoch = uuid()?;
        let generation_id = uuid()?;
        let joined =
            time - (p.join_days_ago as i64 * 86400000) - ((ordinal as i64 * 7919) % 86400000);
        let nickname = policy::nickname(ordinal);
        let subject = policy::subject_hmac(&seed, ordinal as u64);
        writes.push(statement(db,"INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id,epoch_id,active_device_id) VALUES(?1,?2,'joined','none',1,?3,?4,?5)",&[text(&participant),text(&subject),text(&generation_id),text(&epoch),text(&device)])?);
        writes.push(statement(
            db,
            "INSERT INTO participant_revisions VALUES(?1,0)",
            &[text(&participant)],
        )?);
        // Distinct licensed photos while they last; most bots keep the default avatar.
        let photo = (policy::has_photo(&seed) && photo_index < crate::bot_photos::PHOTOS.len())
            .then(|| crate::bot_photos::PHOTOS[photo_index].1);
        let avatar_style = if photo.is_some() { "photo" } else { "none" };
        let avatar = if photo.is_some() {
            photo_index += 1;
            Some(uuid()?)
        } else {
            None
        };
        writes.push(statement(db,"INSERT INTO profiles(participant_id,nickname,avatar_id,nickname_status,avatar_status) VALUES(?1,?2,?3,'approved',?4)",&[text(&participant),text(&nickname),avatar.as_deref().map(text).unwrap_or(wasm_bindgen::JsValue::NULL),text(if avatar.is_some(){"approved"}else{"none"})])?);
        writes.push(statement(
            db,
            "INSERT INTO epochs VALUES(?1,?2,?3,1,?4,?5,?6,NULL)",
            &[
                text(&epoch),
                text(&participant),
                text(&device),
                text(&generation_id),
                number(joined),
                number(time),
            ],
        )?);
        writes.push(statement(db,"INSERT INTO bot_profiles(participant_id,persona_id,persona_version,seed,joined_at_ms,created_at_ms,avatar_style) VALUES(?1,?2,?3,?4,?5,?6,?7)",&[text(&participant),text(&p.id),number(p.version as i64),blob(&seed),number(joined),number(time),text(avatar_style)])?);
        if let (Some(avatar_id), Some(bytes)) = (avatar, photo) {
            let original = format!("private/bot/{avatar_id}/original");
            let derivative = format!("private/bot/{avatar_id}/derivative");
            let bytes = bytes.to_vec();
            crate::avatar_runtime::put_once(&bucket, &original, bytes.clone(), "image/jpeg")
                .await?;
            crate::avatar_runtime::put_once(&bucket, &derivative, bytes.clone(), "image/jpeg")
                .await?;
            let hash = Sha256::digest(&bytes);
            writes.push(statement(db,"INSERT INTO avatar_objects(avatar_id,participant_id,operation_id,normalized_hash,state,original_key,derivative_key,created_at_ms) VALUES(?1,?2,?3,?4,'approved',?5,?6,?7)",&[text(&avatar_id),text(&participant),text(&format!("bot-{ordinal}")),blob(&hash),text(&original),text(&derivative),number(time)])?);
        }
        writes.push(crate::milestone_runtime::initialize(
            db,
            &participant,
            &Generation {
                revision: 1,
                reset_id: Id::parse(&generation_id).map_err(|_| Failure::unavailable())?,
            },
            0,
            true,
        )?);
        // D1 batches are bounded; flush often enough that a 50-bot launch still commits.
        if writes.len() >= 40 {
            db.batch(std::mem::take(&mut writes))
                .await
                .map_err(|_| Failure::conflict())?;
        }
    }
    if !writes.is_empty() {
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
    }
    Ok(())
}

async fn board_cap(db: &D1Database, bot: &Bot, period: &str, current: u64) -> Result<u64, Failure> {
    #[derive(Deserialize)]
    struct Score {
        folds: i64,
    }
    let top=statement(db,"SELECT max(s.folds) AS folds FROM live_scores s JOIN participants p ON p.participant_id=s.participant_id LEFT JOIN bot_profiles b ON b.participant_id=p.participant_id WHERE s.period_id=?1 AND b.participant_id IS NULL AND p.membership='joined' AND p.restriction='none' AND p.account_state='active'",&[text(period)])?.first::<Score>(None).await.map_err(|_|Failure::unavailable())?.and_then(|r|(r.folds>0).then_some(r.folds as u64));
    let seed: [u8; 32] = bot
        .seed
        .as_slice()
        .try_into()
        .map_err(|_| Failure::unavailable())?;
    // Never lower a score already earned, but never above this bot's own share of the leader.
    let ceiling = policy::bot_ceiling(top, policy::ceiling_permille(&seed));
    Ok(ceiling.max(current).min(policy::score_ceiling(top)))
}

async fn replay_day(
    db: &D1Database,
    bot: &Bot,
    persona: &Persona,
    day_ms: i64,
    received: i64,
) -> Result<usize, Failure> {
    let seed: [u8; 32] = bot
        .seed
        .as_slice()
        .try_into()
        .map_err(|_| Failure::unavailable())?;
    let day = day_ms.div_euclid(86400000);
    if day_ms < bot.joined_at_ms {
        return Ok(0);
    }
    let date = NaiveDate::from_ymd_opt(1970, 1, 1)
        .and_then(|d| d.checked_add_signed(chrono::Duration::days(day)))
        .ok_or_else(Failure::unavailable)?;
    let weekend = matches!(date.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun);
    let planned = policy::day_plan(persona, policy::day_seed(&seed, day), weekend);
    // Only folds whose close time has already passed; today's slice fills in on later ticks.
    let happened = planned
        .as_chunks::<2>()
        .0
        .iter()
        .take_while(|[_, close]| day_ms + i64::from(*close) * 60000 <= received)
        .count();
    let pairs = happened.min(DAY_EVENTS / 2);
    #[derive(Deserialize)]
    struct Recorded {
        count: i64,
    }
    let first_sequence = day.max(0) * DAY_EVENTS as i64 + 1;
    let recorded = statement(
        db,
        "SELECT count(*) AS count FROM observations WHERE participant_id=?1 AND device_id=?2 AND sequence BETWEEN ?3 AND ?4",
        &[
            text(&bot.participant_id),
            text(&bot.device_id),
            number(first_sequence),
            number(first_sequence + DAY_EVENTS as i64 - 1),
        ],
    )?
    .first::<Recorded>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .map_or(0, |r| r.count.max(0) as usize);
    let recorded_pairs = recorded / 2;
    if pairs <= recorded_pairs {
        return Ok(0);
    }
    let generation = Generation {
        revision: 1,
        reset_id: Id::parse(&bot.generation_id).map_err(|_| Failure::unavailable())?,
    };
    let event_count = (pairs - recorded_pairs) as u64 * 2;
    let all = statement(
        db,
        "SELECT folds FROM live_scores WHERE participant_id=?1 AND period_id='all'",
        &[text(&bot.participant_id)],
    )?
    .first::<ScoreValue>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .map_or(0, |r| r.folds.max(0) as u64);
    let mut allowed = event_count.min(board_cap(db, bot, "all", all).await?.saturating_sub(all));
    for window in crate::periods::current(day_ms.max(0) as u64).ok_or_else(Failure::unavailable)? {
        let old = statement(
            db,
            "SELECT folds FROM live_scores WHERE participant_id=?1 AND period_id=?2",
            &[text(&bot.participant_id), text(&window.id)],
        )?
        .first::<ScoreValue>(None)
        .await
        .map_err(|_| Failure::unavailable())?
        .map_or(0, |r| r.folds.max(0) as u64);
        allowed = allowed.min(
            board_cap(db, bot, &window.id, old)
                .await?
                .saturating_sub(old),
        );
    }
    let count = (allowed / 2).min((pairs - recorded_pairs) as u64) as usize;
    // Re-read the source cap before every batch; no bot event is inserted before all three caps pass.
    if count == 0 {
        return Ok(0);
    }
    let mut events = Vec::with_capacity(count * 2);
    let base = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(Failure::unavailable)?
        .and_utc()
        .timestamp_millis();
    let first = recorded_pairs * 2;
    for (offset, &minute) in planned[first..(recorded_pairs + count) * 2]
        .iter()
        .enumerate()
    {
        let i = first + offset;
        events.push(Event {
            schema_version: 1,
            event_id: event_id(bot, day, i as u64),
            device_id: Id::parse(&bot.device_id).map_err(|_| Failure::unavailable())?,
            sequence: day.max(0) as u64 * DAY_EVENTS as u64 + i as u64 + 1,
            generation: generation.clone(),
            observed_at_ms: (base + minute as i64 * 60000).max(0) as u64,
            timezone_id: persona.timezone.clone(),
            transition: if i % 2 == 0 {
                Transition::Open
            } else {
                Transition::Close
            },
            is_test: false,
            competition_epoch_id: Some(
                Id::parse(&bot.epoch_id).map_err(|_| Failure::unavailable())?,
            ),
        });
    }
    let existing=statement(db,"SELECT event_json FROM observations WHERE participant_id=?1 AND disposition='accepted' ORDER BY device_id,sequence",&[text(&bot.participant_id)])?.all().await.map_err(|_|Failure::unavailable())?.results::<ExistingEvent>().map_err(|_|Failure::unavailable())?;
    let mut stream = existing
        .into_iter()
        .map(|r| serde_json::from_str::<Event>(&r.event_json).map_err(|_| Failure::unavailable()))
        .collect::<Result<Vec<_>, _>>()?;
    stream.extend(events.clone());
    let summary = reducer::reduce(&stream, &[], &generation).map_err(|_| Failure::unavailable())?;
    let decision = statement(
        db,
        "UPDATE decision_clock SET version=version+1 WHERE singleton=1 RETURNING version",
        &[],
    )?
    .first::<Decision>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or_else(Failure::unavailable)?
    .version;
    let mut writes = Vec::new();
    for event in &events {
        writes.push(statement(db,"INSERT OR IGNORE INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,received_at_ms,decision_version,submission_id) VALUES(?1,?2,?3,?4,?5,'accepted',?6,?7,NULL)",&[text(&bot.participant_id),text(event.event_id.as_str()),text(event.device_id.as_str()),number(event.sequence as i64),text(&serde_json::to_string(event).map_err(|_|Failure::unavailable())?),number(received),number(decision)])?);
    }
    // live_scores is a replay projection only; every score here came from the accepted event stream.
    let generation_id = generation.reset_id.as_str();
    writes.push(statement(db,"INSERT INTO live_scores(participant_id,generation_revision,generation_id,period_id,folds,revision) VALUES(?1,1,?2,'all',?3,1) ON CONFLICT(participant_id,period_id) DO UPDATE SET folds=excluded.folds,revision=revision+1,generation_id=excluded.generation_id,generation_revision=1",&[text(&bot.participant_id),text(generation_id),number(summary.folds() as i64)])?);
    let mut windows = std::collections::BTreeMap::new();
    for ev in &stream {
        for w in crate::periods::current(ev.observed_at_ms).ok_or_else(Failure::unavailable)? {
            windows.insert(w.id.clone(), w);
        }
    }
    for w in windows.values() {
        let folds = summary
            .counted_events
            .iter()
            .filter_map(|id| stream.iter().find(|e| &e.event_id == id))
            .filter(|e| e.observed_at_ms >= w.start_ms && e.observed_at_ms < w.end_ms)
            .count() as i64;
        writes.push(statement(db,"INSERT INTO periods(period_id,kind,start_ms,end_ms,cutoff_ms,state) VALUES(?1,?2,?3,?4,?5,'open') ON CONFLICT(period_id) DO NOTHING",&[text(&w.id),text(w.kind),number(w.start_ms as i64),number(w.end_ms as i64),number(w.end_ms as i64+86400000)])?);
        writes.push(statement(db,"INSERT INTO live_scores(participant_id,generation_revision,generation_id,period_id,folds,revision) VALUES(?1,1,?2,?3,?4,1) ON CONFLICT(participant_id,period_id) DO UPDATE SET folds=excluded.folds,revision=revision+1,generation_id=excluded.generation_id,generation_revision=1",&[text(&bot.participant_id),text(generation_id),text(&w.id),number(folds)])?);
    }
    writes.push(statement(db,"INSERT INTO score_jobs VALUES(?1,1,'pending') ON CONFLICT(participant_id) DO UPDATE SET revision=revision+1,state='pending'",&[text(&bot.participant_id)])?);
    #[derive(Deserialize)]
    struct Counted {
        event_id: Id,
        observed_at_ms: u64,
    }
    let before = statement(
        db,
        "SELECT event_id,observed_at_ms FROM milestone_counted_events WHERE participant_id=?1",
        &[text(&bot.participant_id)],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results::<Counted>()
    .map_err(|_| Failure::unavailable())?
    .into_iter()
    .map(|e| (e.event_id, e.observed_at_ms))
    .collect::<Vec<_>>();
    let after = summary
        .counted_events
        .iter()
        .filter_map(|id| {
            stream
                .iter()
                .find(|e| &e.event_id == id)
                .map(|e| (e.event_id.clone(), e.observed_at_ms))
        })
        .collect::<Vec<_>>();
    writes.extend(
        crate::milestone_runtime::incremental(
            db,
            &bot.participant_id,
            &generation,
            1,
            &before,
            &after,
        )
        .await?,
    );
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    Ok(count * 2)
}
#[derive(Deserialize)]
struct ScoreValue {
    folds: i64,
}
#[derive(Deserialize)]
struct ExistingEvent {
    event_json: String,
}
#[derive(Deserialize)]
struct Decision {
    version: i64,
}

/// One resumable UTC-day slice. Replaying a slice is safe because event IDs and observation keys are deterministic.
pub(crate) async fn tick(env: &Env, db: &D1Database, dry_run: bool) -> Result<usize, Failure> {
    let time = now();
    if dry_run {
        #[derive(Deserialize)]
        struct Active {
            count: i64,
        }
        return Ok(statement(db,"SELECT count(*) AS count FROM bot_profiles WHERE retired_at_ms IS NULL AND paused_at_ms IS NULL",&[])?.first::<Active>(None).await.map_err(|_|Failure::unavailable())?.map_or(0,|v|v.count.max(0) as usize));
    }
    create_roster(env, db, time).await?;
    let state=statement(db,"SELECT watermark_ms,revision,cursor_participant_id,launch_started_at_ms FROM bot_simulation_state WHERE singleton=1",&[])?.first::<State>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    let day = if state.watermark_ms == 0 {
        statement(db,"SELECT min(joined_at_ms) AS watermark_ms FROM bot_profiles WHERE retired_at_ms IS NULL",&[])?.first::<MinTime>(None).await.map_err(|_|Failure::unavailable())?.map_or(time,|v|v.watermark_ms).div_euclid(86400000)*86400000
    } else {
        state.watermark_ms
    };
    // Bot join dates are backdated for display only; simulated folds begin on the launch day.
    let launch_day = state
        .launch_started_at_ms
        .unwrap_or(time)
        .div_euclid(86400000)
        * 86400000;
    let today = time.div_euclid(86400000) * 86400000;
    let day = day.max(launch_day);
    if day > today {
        return Ok(0);
    }
    let bots=statement(db,"SELECT b.participant_id,b.persona_id,b.persona_version,b.seed,b.joined_at_ms,p.active_device_id AS device_id,p.epoch_id,p.generation_id FROM bot_profiles b JOIN participants p ON p.participant_id=b.participant_id WHERE b.retired_at_ms IS NULL AND b.paused_at_ms IS NULL AND b.joined_at_ms<=?1 AND (?2 IS NULL OR b.participant_id>?2) ORDER BY b.participant_id LIMIT ?3",&[number(day+86400000),state.cursor_participant_id.as_deref().map(text).unwrap_or(wasm_bindgen::JsValue::NULL),number(BATCH_BOTS as i64)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Bot>().map_err(|_|Failure::unavailable())?;
    let personas = policy::personas();
    let mut total = 0;
    let mut writes = Vec::new();
    for bot in &bots {
        let persona = if bot.persona_id == policy::SEEDED_PERSONA_ID {
            let seed: [u8; 32] = bot
                .seed
                .as_slice()
                .try_into()
                .map_err(|_| Failure::unavailable())?;
            Some(policy::seeded_persona(&seed))
        } else {
            personas
                .iter()
                .find(|p| p.id == bot.persona_id && p.version as i64 == bot.persona_version)
                .cloned()
        };
        if let Some(p) = persona {
            total += replay_day(db, bot, &p, day, time).await?;
        }
    }
    let cursor = if bots.len() == BATCH_BOTS {
        bots.last()
            .map(|b| Some(b.participant_id.clone()))
            .unwrap_or(None)
    } else {
        None
    };
    // Stay on today until it is over so later ticks add the folds that have happened since.
    let next = if cursor.is_some() || day == today {
        day
    } else {
        day + 86400000
    };
    writes.push(statement(db,"UPDATE bot_simulation_state SET watermark_ms=?1,cursor_participant_id=?2,revision=revision+1 WHERE singleton=1 AND revision=?3",&[number(next),cursor.as_deref().map(text).unwrap_or(wasm_bindgen::JsValue::NULL),number(state.revision)])?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    Ok(total)
}
#[derive(Deserialize)]
struct MinTime {
    watermark_ms: i64,
}
