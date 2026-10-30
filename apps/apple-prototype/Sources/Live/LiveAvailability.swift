enum LiveAvailability: Equatable, Sendable {
    case loading
    case live
    case unavailable(String)
}
