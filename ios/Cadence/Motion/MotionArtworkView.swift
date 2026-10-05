import AVFoundation
import SwiftUI
import UIKit

/// A muted, looping HLS video layer (used for Apple Music motion artwork).
struct LoopingVideoView: UIViewRepresentable {
    let url: URL
    var onReady: () -> Void

    func makeUIView(context: Context) -> PlayerContainerView {
        let view = PlayerContainerView()
        view.onReady = onReady
        view.play(url)
        return view
    }

    func updateUIView(_ view: PlayerContainerView, context: Context) {
        view.onReady = onReady
        if view.currentURL != url { view.play(url) }
    }

    static func dismantleUIView(_ view: PlayerContainerView, coordinator: ()) {
        view.stop()
    }

    final class PlayerContainerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        private var looper: AVPlayerLooper?
        private var readyObservation: NSKeyValueObservation?
        private(set) var currentURL: URL?
        var onReady: (() -> Void)?

        func play(_ url: URL) {
            stop()
            currentURL = url
            let player = AVQueuePlayer()
            player.isMuted = true
            player.preventsDisplaySleepDuringVideoPlayback = false
            player.allowsExternalPlayback = false
            let item = AVPlayerItem(url: url)
            item.preferredMaximumResolution = CGSize(width: 1080, height: 1080)
            looper = AVPlayerLooper(player: player, templateItem: item)
            playerLayer.player = player
            playerLayer.videoGravity = .resizeAspectFill
            readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { [weak self] layer, _ in
                guard layer.isReadyForDisplay else { return }
                DispatchQueue.main.async { self?.onReady?() }
            }
            player.play()
        }

        func stop() {
            readyObservation = nil
            playerLayer.player?.pause()
            looper?.disableLooping()
            looper = nil
            playerLayer.player = nil
            currentURL = nil
        }
    }
}

/// Static cover art that cross-fades into Apple Music motion artwork when available.
struct MotionArtworkView: View {
    let albumID: String?
    let album: String?
    let artist: String?
    let coverID: String?
    var size: CGFloat
    var cornerRadius: CGFloat = 10

    @Environment(AppSettings.self) private var settings
    @State private var videoURL: URL?
    @State private var videoReady = false

    var body: some View {
        ZStack {
            ArtworkView(id: coverID, size: size, cornerRadius: cornerRadius, large: true)
            if let videoURL {
                LoopingVideoView(url: videoURL) {
                    withAnimation(.easeInOut(duration: 0.6)) { videoReady = true }
                }
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .opacity(videoReady ? 1 : 0)
                .allowsHitTesting(false)
            }
        }
        .frame(width: size, height: size)
        .task(id: lookupKey) {
            videoReady = false
            videoURL = nil
            guard settings.motionEnabled, let albumID, let album else { return }
            let config = MotionService.Config(autoToken: settings.motionAutoToken, token: settings.motionToken, storefront: settings.storefront)
            if config.autoToken || !config.token.isEmpty {
                videoURL = await MotionService.shared.videoURL(albumID: albumID, album: album, artist: artist ?? "", config: config)
            }
        }
    }

    private var lookupKey: String {
        "\(albumID ?? "")|\(settings.motionEnabled)|\(settings.motionAutoToken)|\(settings.motionToken)|\(settings.storefront)"
    }
}
