import AppKit
import Vision

guard CommandLine.arguments.count > 1,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write(Data("无法读取图片\n".utf8))
  exit(1)
}

let request = VNRecognizeTextRequest { request, error in
  if let error = error {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
  }
  let lines = (request.results as? [VNRecognizedTextObservation] ?? [])
    .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
    .compactMap { $0.topCandidates(1).first?.string }
  print(lines.joined(separator: "\n"))
}
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true

do {
  try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
} catch {
  FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
  exit(1)
}
