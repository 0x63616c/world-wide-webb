import CryptoKit
import Foundation

let key = P256.Signing.PrivateKey()
let appID = "TEAMID1234.app.getfolding.Folding.Staging"
let clientHash = Data(SHA256.hash(data: Data("synthetic-binding-fixture".utf8)))
var authenticator = Data(SHA256.hash(data: Data(appID.utf8)))
authenticator.append(contentsOf: [0, 0, 0, 0, 1])
let nonce = Data(SHA256.hash(data: authenticator + clientHash))
let signature = try key.signature(for: nonce)
let result = [
  "provenance":
    "Synthetic assertion signed by Apple CryptoKit P256.Signing.PrivateKey.signature(for: nonce Data); not a real App Attest device vector",
  "app_id": appID, "client_hash": clientHash.base64EncodedString(),
  "authenticator_data": authenticator.base64EncodedString(),
  "public_key_sec1": key.publicKey.x963Representation.base64EncodedString(),
  "signature_der": signature.derRepresentation.base64EncodedString(),
]
let encoded = try JSONSerialization.data(
  withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(data: encoded, encoding: .utf8)!)
