use crate::{admin_auth::Administrator,auth_runtime::{Configuration,Failure,now,number,statement,text,uuid}};
use askama::Template;
use folding_domain::wire::Id;
use serde::{Deserialize,Serialize};
use worker::*;

#[derive(Deserialize)] struct Bot { participant_id:String,nickname:String,persona_id:String,persona_version:i64,joined_at_ms:i64,retired_at_ms:Option<i64>,paused_at_ms:Option<i64>,revision:i64 }
#[derive(Template)] #[template(path="bots.html")] struct Page { csrf:String,operation:String,rows:Vec<Bot> }
#[derive(Deserialize,Serialize)] #[serde(deny_unknown_fields)] struct Command { operation_id:Id,csrf_token:String,action:String,participant_id:String,expected_revision:i64,reason:String }

pub(crate) async fn admin(request:&Request,env:&Env,db:&D1Database,config:&Configuration,admin:&Administrator,body:&[u8])->Result<Response,Failure>{
    if request.method()==Method::Get {
        let rows=statement(db,"SELECT b.participant_id,p.nickname,b.persona_id,b.persona_version,b.joined_at_ms,b.retired_at_ms,b.paused_at_ms,b.revision FROM bot_profiles b JOIN profiles p ON p.participant_id=b.participant_id ORDER BY b.joined_at_ms DESC,b.participant_id LIMIT 200",&[])?.all().await.map_err(|_|Failure::unavailable())?.results().map_err(|_|Failure::unavailable())?;
        let page=Page{csrf:admin.csrf.clone(),operation:uuid()?,rows};
        return crate::admin_runtime::secure_html(page.render().map_err(|_|Failure::unavailable())?);
    }
    if request.method()!=Method::Post||body.len()>8192{return Err(Failure::malformed())}
    let mut command:Command=serde_urlencoded::from_bytes(body).map_err(|_|Failure::malformed())?;
    admin.check_csrf(request,&command.csrf_token,config)?;
    if !crate::admin_runtime::valid_reason(&command.reason)||command.reason.chars().any(|c|c.is_control()&&c!='\n'){return Err(Failure::malformed())}
    command.csrf_token.clear();
    let time=now(); let audit_id=uuid()?;
    match command.action.as_str(){
        "dry_run"=>{
            let examined=crate::bot_simulation_runtime::tick(env,db,true).await?;
            statement(db,"INSERT INTO bot_simulation_audit VALUES(?1,?2,'dry_run',NULL,?3,?4)",&[text(&audit_id),text(&admin.actor),text(&format!("{}; examined {examined} active bot records; no observations written",command.reason)),number(time)])?.run().await.map_err(|_|Failure::conflict())?;
        }
        action @ ("pause"|"resume"|"retire")=>{
            let participant=Id::parse(&command.participant_id).map_err(|_|Failure::malformed())?;
            if command.expected_revision<0{return Err(Failure::malformed())}
            let update=match action{"pause"=>"UPDATE bot_profiles SET paused_at_ms=?1,revision=revision+1 WHERE participant_id=?2 AND revision=?3 AND retired_at_ms IS NULL","resume"=>"UPDATE bot_profiles SET paused_at_ms=NULL,revision=revision+1 WHERE participant_id=?2 AND revision=?3 AND retired_at_ms IS NULL","retire"=>"UPDATE bot_profiles SET retired_at_ms=?1,paused_at_ms=NULL,revision=revision+1 WHERE participant_id=?2 AND revision=?3 AND retired_at_ms IS NULL",_=>unreachable!()};
            let args=if action=="resume"{vec![wasm_bindgen::JsValue::NULL,text(participant.as_str()),number(command.expected_revision)]}else{vec![number(time),text(participant.as_str()),number(command.expected_revision)]};
            db.batch(vec![statement(db,"INSERT INTO mutation_guards VALUES(?1,CASE WHEN EXISTS(SELECT 1 FROM bot_profiles WHERE participant_id=?2 AND revision=?3 AND retired_at_ms IS NULL) THEN 1 ELSE 0 END)",&[text(&format!("{audit_id}-fence")),text(participant.as_str()),number(command.expected_revision)])?,statement(db,update,&args)?,statement(db,"INSERT INTO bot_simulation_audit VALUES(?1,?2,?3,?4,?5,?6)",&[text(&audit_id),text(&admin.actor),text(action),text(participant.as_str()),text(&command.reason),number(time)])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&format!("{audit_id}-fence"))])?]).await.map_err(|_|Failure::conflict())?;
            if action=="retire" { statement(db,"UPDATE participants SET membership='left',active_device_id=NULL WHERE participant_id=?1",&[text(participant.as_str())])?.run().await.map_err(|_|Failure::conflict())?; }
        }
        _=>return Err(Failure::malformed())
    }
    let mut response=Response::empty().map_err(|_|Failure::unavailable())?.with_status(303);
    response.headers_mut().set("Location","/admin/bots").map_err(|_|Failure::unavailable())?;
    response.headers_mut().set("Cache-Control","no-store").map_err(|_|Failure::unavailable())?;
    Ok(response)
}
