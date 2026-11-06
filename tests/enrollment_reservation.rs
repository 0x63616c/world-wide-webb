use homelab_client::enrollment_reservation::{Attempt, Error, Phase, Reservation};
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};

fn attempt(id: char) -> Attempt {
    Attempt {
        id: id.to_string().repeat(64),
        repository: "example/config".into(),
        host: "build-mac".into(),
    }
}

#[test]
fn competing_attempts_cannot_renew_or_claim_an_owned_target() {
    let home = tempfile::tempdir().unwrap();
    fs::set_permissions(home.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let reservation = Reservation::open(home.path()).unwrap();
    assert!(matches!(Reservation::open(home.path()), Err(Error::Busy)));
    assert_eq!(
        reservation.acquire(&attempt('a')).unwrap(),
        Phase::Preparing
    );
    assert_eq!(reservation.acquire(&attempt('b')), Err(Error::Busy));
    assert_eq!(reservation.renewal_allowed(&attempt('b')), Err(Error::Busy));
    assert_eq!(
        reservation.claim_bootstrap(&attempt('b'), &"a".repeat(40)),
        Err(Error::Busy)
    );
    drop(reservation);
    let resumed = Reservation::open(home.path()).unwrap();
    assert_eq!(resumed.acquire(&attempt('a')).unwrap(), Phase::Preparing);
    resumed.release_preparation(&attempt('a')).unwrap();
    resumed.release_preparation(&attempt('a')).unwrap();
    assert_eq!(resumed.acquire(&attempt('b')).unwrap(), Phase::Preparing);
}

#[test]
fn bootstrap_appearing_after_acquisition_prevents_release_and_renewal() {
    let home = tempfile::tempdir().unwrap();
    fs::set_permissions(home.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let reservation = Reservation::open(home.path()).unwrap();
    reservation.acquire(&attempt('a')).unwrap();
    fs::create_dir_all(home.path().join(".local/state/homelab/bootstrap")).unwrap();
    assert_eq!(
        reservation.renewal_allowed(&attempt('a')),
        Err(Error::Started)
    );
    assert_eq!(
        reservation.release_preparation(&attempt('a')),
        Err(Error::Started)
    );
    assert_eq!(reservation.acquire(&attempt('b')), Err(Error::Busy));
}

#[test]
fn claimed_revision_survives_disconnect_and_prevents_renewal_or_cancellation() {
    let home = tempfile::tempdir().unwrap();
    fs::set_permissions(home.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let reservation = Reservation::open(home.path()).unwrap();
    reservation.acquire(&attempt('a')).unwrap();
    reservation
        .claim_bootstrap(&attempt('a'), &"b".repeat(40))
        .unwrap();
    drop(reservation);
    let resumed = Reservation::open(home.path()).unwrap();
    assert_eq!(
        resumed.acquire(&attempt('a')).unwrap(),
        Phase::BootstrapClaimed {
            revision: "b".repeat(40)
        }
    );
    resumed
        .claim_bootstrap(&attempt('a'), &"b".repeat(40))
        .unwrap();
    assert_eq!(
        resumed.claim_bootstrap(&attempt('a'), &"c".repeat(40)),
        Err(Error::Started)
    );
    assert_eq!(resumed.renewal_allowed(&attempt('a')), Err(Error::Started));
    assert_eq!(
        resumed.release_preparation(&attempt('a')),
        Err(Error::Started)
    );
}

#[test]
fn legacy_bootstrap_and_unsafe_state_never_become_fresh_reservations() {
    let home = tempfile::tempdir().unwrap();
    fs::set_permissions(home.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let reservation = Reservation::open(home.path()).unwrap();
    fs::create_dir_all(home.path().join(".local/state/homelab/bootstrap")).unwrap();
    assert_eq!(reservation.acquire(&attempt('a')), Err(Error::Started));
    let state = home.path().join(".homelab-enrollment/reservation.json");
    symlink(home.path().join("missing"), &state).unwrap();
    assert_eq!(reservation.acquire(&attempt('a')), Err(Error::Invalid));
    fs::remove_file(&state).unwrap();
    fs::write(&state, b"not-json").unwrap();
    fs::set_permissions(&state, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(reservation.acquire(&attempt('a')), Err(Error::Invalid));
    assert_eq!(fs::read(&state).unwrap(), b"not-json");
}
