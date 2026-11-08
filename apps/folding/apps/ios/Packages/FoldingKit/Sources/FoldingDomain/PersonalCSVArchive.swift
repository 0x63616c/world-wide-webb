import Foundation

extension PersonalExport {
  /// Standards-compliant uncompressed ZIP. This contains only the four generated export files.
  /// Storage must protect the returned bytes and cancel sharing when its snapshot becomes stale.
  public static func csvArchive(_ document: PersonalExportDocument) throws -> Data {
    let files = csvFiles(document)
    var archive = Data()
    var directory = Data()
    for file in files {
      let name = Data(file.name.utf8)
      guard let length = UInt32(exactly: file.data.count),
        let offset = UInt32(exactly: archive.count),
        let nameLength = UInt16(exactly: name.count)
      else { throw AnalyticsError.resultTooLarge }
      let crc = crc32(file.data)
      archive.appendLE(UInt32(0x0403_4b50))
      archive.appendLE(UInt16(20))  // ZIP 2.0
      archive.appendLE(UInt16(0x0800))  // UTF-8 names
      archive.appendLE(UInt16(0))  // stored, not compressed
      archive.appendLE(UInt16(0))  // fixed time
      archive.appendLE(UInt16(33))  // January 1, 1980
      archive.appendLE(crc)
      archive.appendLE(length)
      archive.appendLE(length)
      archive.appendLE(nameLength)
      archive.appendLE(UInt16(0))
      archive.append(name)
      archive.append(file.data)

      directory.appendLE(UInt32(0x0201_4b50))
      directory.appendLE(UInt16(20))
      directory.appendLE(UInt16(20))
      directory.appendLE(UInt16(0x0800))
      directory.appendLE(UInt16(0))
      directory.appendLE(UInt16(0))
      directory.appendLE(UInt16(33))
      directory.appendLE(crc)
      directory.appendLE(length)
      directory.appendLE(length)
      directory.appendLE(nameLength)
      directory.appendLE(UInt16(0))  // extra
      directory.appendLE(UInt16(0))  // comment
      directory.appendLE(UInt16(0))  // disk
      directory.appendLE(UInt16(0))  // internal attributes
      directory.appendLE(UInt32(0))  // external attributes
      directory.appendLE(offset)
      directory.append(name)
    }
    guard let offset = UInt32(exactly: archive.count),
      let length = UInt32(exactly: directory.count),
      let count = UInt16(exactly: files.count)
    else { throw AnalyticsError.resultTooLarge }
    archive.append(directory)
    archive.appendLE(UInt32(0x0605_4b50))
    archive.appendLE(UInt16(0))
    archive.appendLE(UInt16(0))
    archive.appendLE(count)
    archive.appendLE(count)
    archive.appendLE(length)
    archive.appendLE(offset)
    archive.appendLE(UInt16(0))
    return archive
  }

  private static func crc32(_ bytes: Data) -> UInt32 {
    var crc = UInt32.max
    for byte in bytes {
      crc ^= UInt32(byte)
      for _ in 0..<8 { crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb8_8320 : 0) }
    }
    return crc ^ UInt32.max
  }
}

extension Data {
  fileprivate mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
    var littleEndian = value.littleEndian
    Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
  }
}
