use crate::{
    AppState,
    features::{climate, lights, weather},
    now,
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};
use tokio::{sync::watch, task::JoinHandle};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerHealth {
    pub last_run_at: Option<String>,
    pub last_duration_ms: u128,
    pub total_runs: u64,
    pub consecutive_failures: u64,
    pub storage_failures: u64,
}
pub type Health = Arc<RwLock<BTreeMap<String, WorkerHealth>>>;
pub struct Runtime {
    stop: watch::Sender<bool>,
    tasks: Vec<(&'static str, JoinHandle<()>)>,
    workers: Health,
    started: Instant,
}
impl Runtime {
    pub fn start(s: AppState) -> Result<Self, reqwest::Error> {
        let stop = s.shutdown.clone();
        let mut stopping = stop.subscribe();
        if !s.config.workers_enabled {
            return Ok(Self {
                stop,
                tasks: vec![],
                workers: s.workers.clone(),
                started: Instant::now(),
            });
        }
        let mut tasks = vec![];
        if s.config.weather.is_some() {
            let s = s.clone();
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()?;
            s.workers
                .write()
                .expect("worker lock")
                .insert("weather-ingest".into(), WorkerHealth::default());
            tasks.push(("weather-ingest", tokio::spawn(async move {
                let mut interval=tokio::time::interval(Duration::from_secs(300));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {
                        _=stopping.changed()=>break,
                        _=interval.tick()=>{
                            let start=Instant::now();
                            let result=weather::ingest(&s,&client).await;
                            let mut workers=s.workers.write().expect("worker lock");
                            let health=workers.get_mut("weather-ingest").expect("registered worker");
                            health.total_runs+=1;health.last_run_at=Some(now());health.last_duration_ms=start.elapsed().as_millis();
                            health.storage_failures=if result.as_ref().err().is_some_and(|e| e.message=="Storage unavailable"){health.storage_failures+1}else{0};health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                            if result.is_err(){tracing::warn!(worker="weather-ingest","cycle failed");}
                        }
                    }
                }
            })));
        }
        if s.config.ha.is_some() {
            let s = s.clone();
            let mut stopping = stop.subscribe();
            s.workers
                .write()
                .expect("worker lock")
                .insert("light-enforcer".into(), WorkerHealth::default());
            tasks.push(("light-enforcer", tokio::spawn(async move {
                let mut party=lights::PartyClock::default();
                let mut interval=tokio::time::interval(Duration::from_secs(1));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {tokio::select! {
                    _=stopping.changed()=>break,
                    _=interval.tick()=>{
                        let start=Instant::now();
                        let mut result=lights::party(&s,&mut party).await;
                        if result.is_ok(){result=lights::reconcile(&s).await;}
                        let mut workers=s.workers.write().expect("worker lock");
                        let health=workers.get_mut("light-enforcer").expect("registered worker");
                        health.total_runs+=1;health.last_run_at=Some(now());health.last_duration_ms=start.elapsed().as_millis();
                        health.storage_failures=if result.as_ref().err().is_some_and(|e| e.message=="Storage unavailable"){health.storage_failures+1}else{0};health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                        if result.is_err(){tracing::warn!(worker="light-enforcer","cycle failed");}
                    }
                }}
            })));
        }
        if s.config.ha.is_some() {
            s.workers
                .write()
                .expect("worker lock")
                .insert("climate-enforcer".into(), WorkerHealth::default());
            let mut stopping = stop.subscribe();
            let s = s.clone();
            tasks.push(("climate-enforcer", tokio::spawn(async move {
                let mut last_fan=None;
                let mut interval=tokio::time::interval(Duration::from_secs(1));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {
                        _=stopping.changed()=>break,
                        _=interval.tick()=>{
                            let start=Instant::now();
                            let result=climate::reconcile(&s,&mut last_fan).await;
                            let mut workers=s.workers.write().expect("worker lock");
                            let health=workers.get_mut("climate-enforcer").expect("registered worker");
                            health.total_runs+=1;health.last_run_at=Some(now());health.last_duration_ms=start.elapsed().as_millis();
                            health.storage_failures=if result.as_ref().err().is_some_and(|e| e.message=="Storage unavailable"){health.storage_failures+1}else{0};health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                            if result.is_err(){tracing::warn!(worker="climate-enforcer","cycle failed");}
                        }
                    }
                }
            })));
        }
        if let Some(id) = s.config.bedroom_input.clone() {
            s.workers
                .write()
                .expect("worker lock")
                .insert("bedroom-switch-input".into(), WorkerHealth::default());
            tasks.push((
                "bedroom-switch-input",
                tokio::spawn(crate::features::bedroom_input::run(
                    s.clone(),
                    id,
                    stop.subscribe(),
                )),
            ));
        }
        for (name, is_lights) in [("alarm-clock", false), ("alarm-lights", true)] {
            let s = s.clone();
            let mut stopping = stop.subscribe();
            s.workers
                .write()
                .expect("worker lock")
                .insert(name.into(), WorkerHealth::default());
            tasks.push((name, tokio::spawn(async move {
                let mut interval=tokio::time::interval(Duration::from_secs(1));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {tokio::select! {
                    _=stopping.changed()=>break,
                    _=interval.tick()=>{
                        let start=Instant::now();
                        let result=if is_lights {crate::features::alarms::deliver_lights(&s,chrono::Utc::now()).await} else {crate::features::alarms::claim_due(&s,chrono::Utc::now()).await.map(|_|())};
                        let mut workers=s.workers.write().expect("worker lock");let health=workers.get_mut(name).expect("registered worker");
                        health.total_runs+=1;health.last_run_at=Some(now());health.last_duration_ms=start.elapsed().as_millis();health.storage_failures=if result.as_ref().err().is_some_and(|e| e.message=="Storage unavailable"){health.storage_failures+1}else{0};health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                        if result.is_err(){tracing::warn!(worker=name,"cycle failed");}
                    }
                }}
            })));
        }
        Ok(Self {
            stop,
            tasks,
            workers: s.workers.clone(),
            started: Instant::now(),
        })
    }
    /// A lost or stuck worker must restart the process so Docker replaces its single owner.
    /// Dependency errors still complete cycles and do not cause restart storms.
    pub async fn failure(&self) -> &'static str {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if *self.stop.borrow() {
                std::future::pending::<()>().await;
            }
            let workers = self.workers.read().expect("worker lock");
            for (name, task) in &self.tasks {
                if task.is_finished()
                    || workers.get(*name).is_some_and(|health| {
                        health.storage_failures >= 3 || stale(name, health, self.started.elapsed())
                    })
                {
                    return name;
                }
            }
        }
    }
    pub async fn stop(self) {
        let _ = self.stop.send(true);
        for (name, mut task) in self.tasks {
            if tokio::time::timeout(Duration::from_secs(5), &mut task)
                .await
                .is_err()
            {
                tracing::warn!(worker = name, "aborting worker after shutdown deadline");
                task.abort();
                let _ = task.await;
            }
        }
    }
}

fn stale(name: &str, health: &WorkerHealth, since_start: Duration) -> bool {
    let allowance = if name == "weather-ingest" { 660 } else { 90 };
    match health
        .last_run_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    {
        Some(last) => {
            (chrono::Utc::now() - last.with_timezone(&chrono::Utc)).num_seconds() > allowance
        }
        None => since_start > Duration::from_secs(allowance as u64),
    }
}

pub fn workers_ready(workers: &Health) -> bool {
    workers
        .read()
        .expect("worker lock")
        .iter()
        .all(|(name, health)| {
            health.last_run_at.is_some()
                && health.storage_failures < 3
                && !stale(name, health, Duration::ZERO)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn detects_a_dead_worker_without_waiting_for_shutdown() {
        let stop = watch::channel(false).0;
        let task = tokio::spawn(async { panic!("synthetic worker failure") });
        let runtime = Runtime {
            stop,
            tasks: vec![("fixture", task)],
            workers: Default::default(),
            started: Instant::now(),
        };
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), runtime.failure())
                .await
                .unwrap(),
            "fixture"
        );
    }

    #[tokio::test]
    async fn detects_a_stuck_worker_with_a_stale_heartbeat() {
        let task = tokio::spawn(std::future::pending::<()>());
        let workers: Health = Default::default();
        workers.write().unwrap().insert(
            "alarm-clock".into(),
            WorkerHealth {
                last_run_at: Some(
                    (chrono::Utc::now() - chrono::Duration::seconds(120)).to_rfc3339(),
                ),
                ..Default::default()
            },
        );
        let runtime = Runtime {
            stop: watch::channel(false).0,
            tasks: vec![("alarm-clock", task)],
            workers,
            started: Instant::now(),
        };
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), runtime.failure())
                .await
                .unwrap(),
            "alarm-clock"
        );
        runtime.tasks[0].1.abort();
    }

    #[test]
    fn stale_workers_are_not_healthy_but_transient_dependency_errors_are() {
        let workers: Health = Default::default();
        let old = (chrono::Utc::now() - chrono::Duration::seconds(120)).to_rfc3339();
        workers.write().unwrap().insert(
            "alarm-clock".into(),
            WorkerHealth {
                last_run_at: Some(old.clone()),
                ..Default::default()
            },
        );
        assert!(!workers_ready(&workers));
        let mut guard = workers.write().unwrap();
        guard.get_mut("alarm-clock").unwrap().last_run_at = Some(now());
        guard.get_mut("alarm-clock").unwrap().consecutive_failures = 100;
        drop(guard);
        assert!(workers_ready(&workers));
        assert!(!stale(
            "weather-ingest",
            &WorkerHealth {
                last_run_at: Some(old),
                ..Default::default()
            },
            Duration::ZERO
        ));
    }
}
