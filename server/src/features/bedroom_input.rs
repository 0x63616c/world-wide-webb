use crate::{
    AppState,
    http::{ApiError, Result},
    integrations::homeassistant::Entity,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;
fn failed() -> ApiError {
    ApiError {
        status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
        message: "Bedroom switch connection interrupted",
    }
}
async fn send(socket: &mut crate::integrations::homeassistant::Socket, value: Value) -> Result<()> {
    tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Text(value.to_string().into())),
    )
    .await
    .map_err(|_| failed())?
    .map_err(|_| failed())
}
/// Each connection creates a new continuity tracker, subscribes before taking a
/// snapshot, and never infers an edge across a disconnect or heartbeat gap.
pub async fn session(s: &AppState, id: &str) -> Result<()> {
    let mut socket = s
        .config
        .ha
        .as_ref()
        .ok_or_else(failed)?
        .websocket()
        .await
        .map_err(|_| failed())?;
    send(
        &mut socket,
        json!({"id":1,"type":"subscribe_events","event_type":"state_changed"}),
    )
    .await?;
    let mut binding = super::lights::BedroomInput::default();
    let mut phase = 0;
    let mut pending_ping = None;
    let mut ping_id = 10;
    let mut timer = tokio::time::interval(Duration::from_secs(10));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    timer.tick().await;
    let mut deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        tokio::select! {
            _=tokio::time::sleep_until(deadline)=>return Err(failed()),
            _=timer.tick()=>{
                if phase==2 {
                    if pending_ping.is_some(){return Err(failed())}
                    ping_id+=1;pending_ping=Some(ping_id);
                    send(&mut socket,json!({"id":ping_id,"type":"ping"})).await?;
                }
            },
            message=socket.next()=>{
                let message=message.ok_or_else(failed)?.map_err(|_|failed())?;
                let text=match message {Message::Text(text)=>text,Message::Ping(_)|Message::Pong(_)=>continue,_=>return Err(failed())};
                let value:Value=serde_json::from_str(&text).map_err(|_|failed())?;
                match value["type"].as_str() {
                    Some("result") if value["id"]==1 && phase==0=>{
                        if value["success"]!=true{return Err(failed())}
                        phase=1;send(&mut socket,json!({"id":2,"type":"get_states"})).await?;
                    },
                    Some("result") if value["id"]==2 && phase==1=>{
                        if value["success"]!=true{return Err(failed())}
                        let all:Vec<Entity>=serde_json::from_value(value["result"].clone()).map_err(|_|failed())?;
                        binding.sample(s,id,all.iter().find(|e|e.entity_id==id),true,None).await?;
                        phase=2;deadline=tokio::time::Instant::now()+Duration::from_secs(25);
                        record(s,false);
                    },
                    Some("pong") if pending_ping.is_some() && value["id"].as_u64()==pending_ping=>{
                        pending_ping=None;deadline=tokio::time::Instant::now()+Duration::from_secs(25);record(s,false);
                    },
                    Some("event") if phase==2 && value["id"]==1 && value["event"]["data"]["entity_id"]==id=>{
                        let data=&value["event"]["data"];
                        let current:Option<Entity>=serde_json::from_value(data["new_state"].clone()).map_err(|_|failed())?;
                        let old:Option<Entity>=serde_json::from_value(data["old_state"].clone()).map_err(|_|failed())?;
                        binding.sample(s,id,current.as_ref(),false,old.as_ref()).await?;
                        record(s,false);
                    },
                    _=>{}
                }
            }
        }
    }
}
fn record(s: &AppState, error: bool) {
    let mut workers = s.workers.write().expect("worker lock");
    let health = workers.entry("bedroom-switch-input".into()).or_default();
    health.last_run_at = Some(crate::now());
    health.total_runs += 1;
    health.consecutive_failures = if error {
        health.consecutive_failures + 1
    } else {
        0
    };
}
pub async fn run(s: AppState, id: String, mut stop: tokio::sync::watch::Receiver<bool>) {
    loop {
        tokio::select! {
            _=stop.changed()=>return,
            result=session(&s,&id)=>{
                if result.is_err(){record(&s,true);tracing::warn!(worker="bedroom-switch-input","connection interrupted; rebaseline required");}
            }
        }
        tokio::select! {_=stop.changed()=>return,_=tokio::time::sleep(Duration::from_secs(5))=>{}}
    }
}
