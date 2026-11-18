#[path = "storage/ttl.rs"]
mod ttl;

pub use ttl::{bump_ttl_on_get, extend_instance_ttl, extend_ttl, DEFAULT_TTL};
