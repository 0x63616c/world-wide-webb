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
}
pub type Health = Arc<RwLock<BTreeMap<String, WorkerHealth>>>;
pub struct Runtime {
    stop: watch::Sender<bool>,
    tasks: Vec<JoinHandle<()>>,
}
impl Runtime {
    pub fn start(s: AppState) -> Result<Self, reqwest::Error> {
        let (stop, mut stopping) = watch::channel(false);
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
            tasks.push(tokio::spawn(async move {
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
                            health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                            if result.is_err(){tracing::warn!(worker="weather-ingest","cycle failed");}
                        }
                    }
                }
            }));
        }
        if s.config.ha.is_some() {
            let s = s.clone();
            let mut stopping = stop.subscribe();
            s.workers
                .write()
                .expect("worker lock")
                .insert("light-enforcer".into(), WorkerHealth::default());
            tasks.push(tokio::spawn(async move {
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
                        health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                        if result.is_err(){tracing::warn!(worker="light-enforcer","cycle failed");}
                    }
                }}
            }));
        }
        if s.config.ha.is_some() {
            s.workers
                .write()
                .expect("worker lock")
                .insert("climate-enforcer".into(), WorkerHealth::default());
            let mut stopping = stop.subscribe();
            let s = s.clone();
            tasks.push(tokio::spawn(async move {
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
                            health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                            if result.is_err(){tracing::warn!(worker="climate-enforcer","cycle failed");}
                        }
                    }
                }
            }));
        }
        if let Some(id) = s.config.bedroom_input.clone() {
            s.workers
                .write()
                .expect("worker lock")
                .insert("bedroom-switch-input".into(), WorkerHealth::default());
            tasks.push(tokio::spawn(crate::features::bedroom_input::run(
                s.clone(),
                id,
                stop.subscribe(),
            )));
        }
        for (name, is_lights) in [("alarm-clock", false), ("alarm-lights", true)] {
            let s = s.clone();
            let mut stopping = stop.subscribe();
            s.workers
                .write()
                .expect("worker lock")
                .insert(name.into(), WorkerHealth::default());
            tasks.push(tokio::spawn(async move {
                let mut interval=tokio::time::interval(Duration::from_secs(1));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {tokio::select! {
                    _=stopping.changed()=>break,
                    _=interval.tick()=>{
                        let start=Instant::now();
                        let result=if is_lights {crate::features::alarms::deliver_lights(&s,chrono::Utc::now()).await} else {crate::features::alarms::claim_due(&s,chrono::Utc::now()).await.map(|_|())};
                        let mut workers=s.workers.write().expect("worker lock");let health=workers.get_mut(name).expect("registered worker");
                        health.total_runs+=1;health.last_run_at=Some(now());health.last_duration_ms=start.elapsed().as_millis();health.consecutive_failures=if result.is_err(){health.consecutive_failures+1}else{0};
                        if result.is_err(){tracing::warn!(worker=name,"cycle failed");}
                    }
                }}
            }));
        }
        Ok(Self { stop, tasks })
    }
    pub async fn stop(self) {
        let _ = self.stop.send(true);
        for task in self.tasks {
            if task.await.is_err() {
                tracing::error!("worker terminated unexpectedly");
            }
        }
    }
}
